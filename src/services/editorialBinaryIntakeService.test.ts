import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  computeCrc32,
  computeSha256Hex,
  DEFAULT_IMAGE_INSPECTION_POLICY,
  inspectEditorialImageBinary,
  inspectRightsEvidenceBinary,
} from '../../functions/src/news/editorialBinaryInspector';
import {
  buildPrivateRightsEvidenceStoragePath,
  buildQuarantineEvidenceStoragePath,
  buildQuarantineImageStoragePath,
  EditorialBinaryIntakeError,
  EditorialBinaryIntakeService,
  InMemoryEditorialBinaryStorageAdapter,
  InMemoryIntakeSessionStore,
} from '../../functions/src/news/editorialBinaryIntakeService';
import { InMemoryEditorialImageAssetRepository } from '../../functions/src/news/inMemoryEditorialImageAssetRepository';
import {
  type CallableRequestContext,
  EditorialImageRightsReviewService,
  InMemoryEditorialImageRightsReviewRunner,
} from '../../functions/src/news/editorialImageRightsReviewService';
import {
  AdminRole,
  AdminUser,
} from '../../functions/src/shared/adminContract';
import { AdminRepository } from '../../functions/src/admin/adminRepository';
import { buildEditorialImageVariantStoragePath } from '../../functions/src/shared/editorialImageAssetContract';

/**
 * Deterministic binary builders for PNG, JPEG, WebP, and PDF test fixtures.
 */
function buildPngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crc = computeCrc32(chunk, 4, 8 + data.length);
  chunk.writeUInt32BE(crc, 8 + data.length);
  return chunk;
}

function buildValidPngBuffer(options?: {
  width?: number;
  height?: number;
  extraChunksBeforeIdat?: readonly { type: string; data: Buffer }[];
  trailingBytes?: Buffer;
  corruptIhdrCrc?: boolean;
}): Buffer {
  const width = options?.width ?? 1200;
  const height = options?.height ?? 800;
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth 8
  ihdrData[9] = 6; // colorType 6 (RGBA)
  ihdrData[10] = 0; // compression 0
  ihdrData[11] = 0; // filter 0
  ihdrData[12] = 0; // interlace 0

  const ihdrChunk = buildPngChunk('IHDR', ihdrData);
  if (options?.corruptIhdrCrc) {
    ihdrChunk[ihdrChunk.length - 1] ^= 0xff;
  }

  const extraChunks = (options?.extraChunksBeforeIdat ?? []).map((c) =>
    buildPngChunk(c.type, c.data)
  );

  // Minimal non-empty zlib stream bytes inside IDAT
  const idatData = Buffer.from([0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]);
  const idatChunk = buildPngChunk('IDAT', idatData);
  const iendChunk = buildPngChunk('IEND', Buffer.alloc(0));

  const parts = [
    signature,
    ihdrChunk,
    ...extraChunks,
    idatChunk,
    iendChunk,
  ];
  if (options?.trailingBytes) {
    parts.push(options.trailingBytes);
  }
  return Buffer.concat(parts);
}

/**
 * Constructs a structurally valid, format-compliant PNG buffer of an exact total
 * byte length (>= 87 bytes) by embedding a legitimate `tEXt` ancillary chunk
 * (`Keyword\0Text`) with a valid IEEE 802.3 CRC-32 checksum BEFORE `IDAT` and
 * `IEND` (zero trailing bytes after `IEND`).
 */
function buildValidPngOfExactByteLength(
  targetTotalBytes: number,
  options?: { width?: number; height?: number }
): Buffer {
  // Base PNG without ancillary chunks: 8 (magic) + 25 (IHDR) + 22 (IDAT) + 12 (IEND) = 67 bytes.
  // Adding 1 ancillary chunk of payload length L adds (12 + L) bytes -> total = 79 + L bytes.
  const basePlusChunkFraming = 79;
  const keywordPrefix = Buffer.from('Comment\0', 'ascii'); // 8 bytes
  const payloadLength = targetTotalBytes - basePlusChunkFraming;
  if (payloadLength < keywordPrefix.length) {
    throw new Error(
      `targetTotalBytes (${targetTotalBytes}) must be at least ${basePlusChunkFraming + keywordPrefix.length} bytes.`
    );
  }
  const textPayload = Buffer.alloc(payloadLength, 0x41); // ASCII 'A' (safe Latin-1 text, no polyglot tokens)
  keywordPrefix.copy(textPayload, 0);

  return buildValidPngBuffer({
    width: options?.width ?? 640,
    height: options?.height ?? 480,
    extraChunksBeforeIdat: [{ type: 'tEXt', data: textPayload }],
  });
}

function buildValidJpegBuffer(options?: {
  width?: number;
  height?: number;
  includeMpfApp2?: boolean;
  trailingBytes?: Buffer;
}): Buffer {
  const width = options?.width ?? 1600;
  const height = options?.height ?? 900;

  const soi = Buffer.from([0xff, 0xd8]);

  // APP0 JFIF segment
  const app0Payload = Buffer.from('JFIF\0\x01\x02\x00\x00\x01\x00\x01\x00\x00', 'binary');
  const app0 = Buffer.alloc(4 + app0Payload.length);
  app0[0] = 0xff;
  app0[1] = 0xe0;
  app0.writeUInt16BE(2 + app0Payload.length, 2);
  app0Payload.copy(app0, 4);

  const segments: Buffer[] = [soi, app0];

  if (options?.includeMpfApp2) {
    const mpfPayload = Buffer.from('MPF\0\x49\x49\x2a\x00', 'binary');
    const app2 = Buffer.alloc(4 + mpfPayload.length);
    app2[0] = 0xff;
    app2[1] = 0xe2;
    app2.writeUInt16BE(2 + mpfPayload.length, 2);
    mpfPayload.copy(app2, 4);
    segments.push(app2);
  }

  // SOF0 baseline segment (marker 0xC0, length = 2 + 6 + 3*3 = 17)
  const sof0 = Buffer.alloc(19);
  sof0[0] = 0xff;
  sof0[1] = 0xc0;
  sof0.writeUInt16BE(17, 2);
  sof0[4] = 8; // precision
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3; // 3 components
  // Component 1, 2, 3 descriptors
  sof0.set([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], 10);
  segments.push(sof0);

  // SOS segment (marker 0xDA, length = 12) + byte-stuffed entropy data + EOI
  const sosHeader = Buffer.from([
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00,
    0x3f, 0x00,
  ]);
  // Include a byte-stuffed 0xFF00 sequence and a restart marker 0xFFD0 inside entropy scan
  const entropyScan = Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]);
  const eoi = Buffer.from([0xff, 0xd9]);

  segments.push(sosHeader, entropyScan, eoi);
  if (options?.trailingBytes) {
    segments.push(options.trailingBytes);
  }

  return Buffer.concat(segments);
}

function buildValidWebpLossyBuffer(options?: {
  width?: number;
  height?: number;
  animatedVp8x?: boolean;
  includeAnimChunk?: boolean;
  trailingBytes?: Buffer;
}): Buffer {
  const width = options?.width ?? 1024;
  const height = options?.height ?? 768;

  // VP8 keyframe chunk: 3-byte frame tag (keyframe = bit 0 is 0) + 0x9D 0x01 0x2A + 16-bit LE width + 16-bit LE height + 2 dummy bytes
  const vp8Data = Buffer.alloc(12);
  vp8Data[0] = 0x10; // keyframe (bit 0 === 0)
  vp8Data[1] = 0x00;
  vp8Data[2] = 0x00;
  vp8Data[3] = 0x9d;
  vp8Data[4] = 0x01;
  vp8Data[5] = 0x2a;
  vp8Data.writeUInt16LE(width & 0x3fff, 6);
  vp8Data.writeUInt16LE(height & 0x3fff, 8);
  vp8Data[10] = 0x01;
  vp8Data[11] = 0x02;

  const vp8Chunk = Buffer.alloc(8 + vp8Data.length);
  vp8Chunk.write('VP8 ', 0, 4, 'ascii');
  vp8Chunk.writeUInt32LE(vp8Data.length, 4);
  vp8Data.copy(vp8Chunk, 8);

  const subchunks: Buffer[] = [];

  if (options?.animatedVp8x !== undefined) {
    const vp8xData = Buffer.alloc(10);
    vp8xData[0] = options.animatedVp8x ? 0x02 : 0x00;
    const wMinus1 = width - 1;
    const hMinus1 = height - 1;
    vp8xData[4] = wMinus1 & 0xff;
    vp8xData[5] = (wMinus1 >>> 8) & 0xff;
    vp8xData[6] = (wMinus1 >>> 16) & 0xff;
    vp8xData[7] = hMinus1 & 0xff;
    vp8xData[8] = (hMinus1 >>> 8) & 0xff;
    vp8xData[9] = (hMinus1 >>> 16) & 0xff;

    const vp8xChunk = Buffer.alloc(18);
    vp8xChunk.write('VP8X', 0, 4, 'ascii');
    vp8xChunk.writeUInt32LE(10, 4);
    vp8xData.copy(vp8xChunk, 8);
    subchunks.push(vp8xChunk);
  }

  if (options?.includeAnimChunk) {
    const animChunk = Buffer.alloc(14);
    animChunk.write('ANIM', 0, 4, 'ascii');
    animChunk.writeUInt32LE(6, 4);
    subchunks.push(animChunk);
  }

  subchunks.push(vp8Chunk);
  const subchunkPayload = Buffer.concat(subchunks);

  const riffHeader = Buffer.alloc(12);
  riffHeader.write('RIFF', 0, 4, 'ascii');
  riffHeader.writeUInt32LE(4 + subchunkPayload.length, 4);
  riffHeader.write('WEBP', 8, 4, 'ascii');

  const full = Buffer.concat([riffHeader, subchunkPayload]);
  if (options?.trailingBytes) {
    return Buffer.concat([full, options.trailingBytes]);
  }
  return full;
}

function buildValidPdfBuffer(options?: {
  injectedBodyText?: string;
  omitEof?: boolean;
  trailingBytes?: Buffer;
}): Buffer {
  const body =
    options?.injectedBodyText ??
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n';
  const eofLine = options?.omitEof ? '' : '%%EOF\n';
  const pdfText = `%PDF-1.7\n${body}xref\n0 3\n0000000000 65535 f \nstartxref\n120\n${eofLine}`;
  const base = Buffer.from(pdfText, 'latin1');
  if (options?.trailingBytes) {
    return Buffer.concat([base, options.trailingBytes]);
  }
  return base;
}

class InMemoryTestAdminRepository implements AdminRepository {
  private readonly users = new Map<string, AdminUser>();

  constructor(initialUsers: readonly AdminUser[] = []) {
    for (const u of initialUsers) {
      this.users.set(u.id, { ...u });
    }
  }

  public setAdmin(user: AdminUser): void {
    this.users.set(user.id, { ...user });
  }

  async getAdminByUid(uid: string): Promise<AdminUser | null> {
    const u = this.users.get(uid);
    return u ? { ...u } : null;
  }

  async saveAdmin(admin: AdminUser): Promise<AdminUser> {
    const cloned = { ...admin };
    this.users.set(admin.id, cloned);
    return { ...cloned };
  }
}

const OWNER_ADMIN: AdminUser = {
  id: 'admin_owner_1',
  name: 'Planet Owner',
  email: 'owner@promiseofplanet.org',
  role: AdminRole.Owner,
  isActive: true,
};

const CONTENT_EDITOR_ADMIN: AdminUser = {
  id: 'admin_editor_1',
  name: 'Editorial Creator',
  email: 'editor@promiseofplanet.org',
  role: AdminRole.ContentEditor,
  isActive: true,
};

const RIGHTS_REVIEWER_ADMIN: AdminUser = {
  id: 'admin_reviewer_1',
  name: 'Rights Officer',
  email: 'rights@promiseofplanet.org',
  role: AdminRole.RightsReviewer,
  isActive: true,
};

const VIEWER_ADMIN: AdminUser = {
  id: 'admin_viewer_1',
  name: 'Read Only Viewer',
  email: 'viewer@promiseofplanet.org',
  role: AdminRole.Viewer,
  isActive: true,
};

const AI_ASSISTANT_ADMIN: AdminUser = {
  id: 'admin_ai_1',
  name: 'Automated Assistant',
  email: 'ai@promiseofplanet.org',
  role: AdminRole.AIAssistant,
  isActive: true,
};

function makeAuthContext(uid: string): CallableRequestContext {
  return {
    auth: {
      uid,
      token: { email: `${uid}@promiseofplanet.org` },
    },
  };
}

function createTestHarness() {
  let clockCounter = 0;
  const clock = () => {
    clockCounter += 1;
    return new Date(Date.UTC(2026, 9, 21, 12, 0, clockCounter)).toISOString();
  };

  const adminRepo = new InMemoryTestAdminRepository([
    OWNER_ADMIN,
    CONTENT_EDITOR_ADMIN,
    RIGHTS_REVIEWER_ADMIN,
    VIEWER_ADMIN,
    AI_ASSISTANT_ADMIN,
  ]);

  const assetRepo = new InMemoryEditorialImageAssetRepository();
  const rightsRunner = new InMemoryEditorialImageRightsReviewRunner(
    undefined,
    adminRepo
  );
  const rightsService = new EditorialImageRightsReviewService({
    adminRepository: adminRepo,
    transactionRunner: rightsRunner,
    clock,
  });

  const storageAdapter = new InMemoryEditorialBinaryStorageAdapter({ clock });
  const sessionStore = new InMemoryIntakeSessionStore();

  const intakeService = new EditorialBinaryIntakeService({
    adminRepository: adminRepo,
    assetRepository: assetRepo,
    rightsEvidenceBridge: rightsService,
    storageAdapter,
    sessionStore,
    evidenceLookup: (evidenceId: string) =>
      rightsRunner.getEvidenceRecord(evidenceId),
    onAssetRegisteredHook: async (record) => {
      await rightsRunner.seedInitialPendingAsset(record.asset);
    },
    clock,
  });

  return {
    clock,
    adminRepo,
    assetRepo,
    rightsRunner,
    rightsService,
    storageAdapter,
    sessionStore,
    intakeService,
  };
}

describe('IMG-F3-05 — Preliminary Binary Inspector (editorialBinaryInspector)', () => {
  it('verifies valid static PNG, JPEG, and WebP binaries and derives true SHA-256, byte size, MIME, dimensions, and aspect ratio', () => {
    const pngBuf = buildValidPngBuffer({ width: 1920, height: 1080 });
    const pngRes = inspectEditorialImageBinary(pngBuf, {
      claimedMimeType: 'image/png',
      claimedFilenameOrExtension: 'hero_banner.PNG',
    });

    expect(pngRes.status).toBe('PRELIMINARY_VERIFIED');
    if (pngRes.status === 'PRELIMINARY_VERIFIED') {
      expect(pngRes.detectedMimeType).toBe('image/png');
      expect(pngRes.canonicalExtension).toBe('png');
      expect(pngRes.sizeBytes).toBe(pngBuf.length);
      expect(pngRes.sha256Checksum).toBe(computeSha256Hex(pngBuf));
      expect(pngRes.width).toBe(1920);
      expect(pngRes.height).toBe(1080);
      expect(pngRes.totalPixels).toBe(1920 * 1080);
      expect(pngRes.aspectRatio).toBe(1.7778);
      expect(pngRes.animated).toBe(false);
      expect(pngRes.fullPixelDecodePerformed).toBe(false);
      expect(pngRes.reencodedOrStripped).toBe(false);
    }

    const jpegBuf = buildValidJpegBuffer({ width: 1600, height: 900 });
    const jpegRes = inspectEditorialImageBinary(jpegBuf, {
      claimedMimeType: 'image/jpeg',
      claimedFilenameOrExtension: 'field_photo.jpeg',
    });

    expect(jpegRes.status).toBe('PRELIMINARY_VERIFIED');
    if (jpegRes.status === 'PRELIMINARY_VERIFIED') {
      expect(jpegRes.detectedMimeType).toBe('image/jpeg');
      expect(jpegRes.canonicalExtension).toBe('jpg');
      expect(jpegRes.width).toBe(1600);
      expect(jpegRes.height).toBe(900);
      expect(jpegRes.aspectRatio).toBe(1.7778);
    }

    const webpBuf = buildValidWebpLossyBuffer({
      width: 1024,
      height: 768,
      animatedVp8x: false,
    });
    const webpRes = inspectEditorialImageBinary(webpBuf, {
      claimedMimeType: 'image/webp',
      claimedFilenameOrExtension: 'coral_reef.webp',
    });

    expect(webpRes.status).toBe('PRELIMINARY_VERIFIED');
    if (webpRes.status === 'PRELIMINARY_VERIFIED') {
      expect(webpRes.detectedMimeType).toBe('image/webp');
      expect(webpRes.canonicalExtension).toBe('webp');
      expect(webpRes.width).toBe(1024);
      expect(webpRes.height).toBe(768);
      expect(webpRes.aspectRatio).toBe(1.3333);
    }
  });

  it('rejects empty buffers, oversized buffers, unknown magic bytes, and claimed MIME/extension mismatches', () => {
    const emptyRes = inspectEditorialImageBinary(Buffer.alloc(0));
    expect(emptyRes.status).toBe('REJECTED');
    if (emptyRes.status === 'REJECTED') {
      expect(emptyRes.rejectionCode).toBe('EMPTY_BINARY');
    }

    const oversizedRes = inspectEditorialImageBinary(Buffer.alloc(1024), {
      policy: { maxSizeBytes: 512 },
    });
    expect(oversizedRes.status).toBe('REJECTED');
    if (oversizedRes.status === 'REJECTED') {
      expect(oversizedRes.rejectionCode).toBe('SIZE_LIMIT_EXCEEDED');
    }

    const gifBuf = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'binary');
    const gifRes = inspectEditorialImageBinary(gifBuf);
    expect(gifRes.status).toBe('REJECTED');
    if (gifRes.status === 'REJECTED') {
      expect(gifRes.rejectionCode).toBe('UNSUPPORTED_MAGIC_BYTES');
    }

    const validPng = buildValidPngBuffer();
    const mimeMismatch = inspectEditorialImageBinary(validPng, {
      claimedMimeType: 'image/jpeg',
    });
    expect(mimeMismatch.status).toBe('REJECTED');
    if (mimeMismatch.status === 'REJECTED') {
      expect(mimeMismatch.rejectionCode).toBe('CLAIMED_MIME_MISMATCH');
    }

    const extMismatch = inspectEditorialImageBinary(validPng, {
      claimedFilenameOrExtension: 'disguised.jpg',
    });
    expect(extMismatch.status).toBe('REJECTED');
    if (extMismatch.status === 'REJECTED') {
      expect(extMismatch.rejectionCode).toBe('CLAIMED_EXTENSION_MISMATCH');
    }
  });

  it('enforces the exact default 15,000,000-byte limit at the 15,000,000 and 15,000,001 byte boundaries without policy overrides', () => {
    expect(DEFAULT_IMAGE_INSPECTION_POLICY.maxSizeBytes).toBe(15_000_000);

    const exactBoundaryPng = buildValidPngOfExactByteLength(15_000_000, {
      width: 640,
      height: 480,
    });
    expect(exactBoundaryPng.length).toBe(15_000_000);

    const exactRes = inspectEditorialImageBinary(exactBoundaryPng, {
      claimedMimeType: 'image/png',
      claimedFilenameOrExtension: 'boundary_exact.png',
    });
    expect(exactRes.status).toBe('PRELIMINARY_VERIFIED');
    if (exactRes.status === 'PRELIMINARY_VERIFIED') {
      expect(exactRes.sizeBytes).toBe(15_000_000);
      expect(exactRes.detectedMimeType).toBe('image/png');
      expect(exactRes.width).toBe(640);
      expect(exactRes.height).toBe(480);
      expect(exactRes.sha256Checksum).toBe(computeSha256Hex(exactBoundaryPng));
      expect(exactRes.fullPixelDecodePerformed).toBe(false);
      expect(exactRes.reencodedOrStripped).toBe(false);
    }

    const oneByteOverPng = buildValidPngOfExactByteLength(15_000_001, {
      width: 640,
      height: 480,
    });
    expect(oneByteOverPng.length).toBe(15_000_001);

    const overRes = inspectEditorialImageBinary(oneByteOverPng, {
      claimedMimeType: 'image/png',
      claimedFilenameOrExtension: 'boundary_over.png',
    });
    expect(overRes.status).toBe('REJECTED');
    if (overRes.status === 'REJECTED') {
      expect(overRes.rejectionCode).toBe('SIZE_LIMIT_EXCEEDED');
      expect(overRes.sizeBytes).toBe(15_000_001);
    }
  });

  it('rejects corrupted PNG CRC-32, axis dimensions > 10,000px, and total pixel budget > 25,000,000px', () => {
    const badCrcPng = buildValidPngBuffer({ corruptIhdrCrc: true });
    const badCrcRes = inspectEditorialImageBinary(badCrcPng);
    expect(badCrcRes.status).toBe('REJECTED');
    if (badCrcRes.status === 'REJECTED') {
      expect(badCrcRes.rejectionCode).toBe('INVALID_CHUNK_CRC');
    }

    const axisExceededPng = buildValidPngBuffer({ width: 10001, height: 100 });
    const axisRes = inspectEditorialImageBinary(axisExceededPng);
    expect(axisRes.status).toBe('REJECTED');
    if (axisRes.status === 'REJECTED') {
      expect(axisRes.rejectionCode).toBe('AXIS_DIMENSION_EXCEEDED');
    }

    // 6000 x 5000 = 30,000,000 pixels (both axes <= 10,000, but exceeds 25MP intake policy budget)
    const pixelBudgetPng = buildValidPngBuffer({ width: 6000, height: 5000 });
    const budgetRes = inspectEditorialImageBinary(pixelBudgetPng);
    expect(budgetRes.status).toBe('REJECTED');
    if (budgetRes.status === 'REJECTED') {
      expect(budgetRes.rejectionCode).toBe('TOTAL_PIXEL_BUDGET_EXCEEDED');
    }
  });

  it('rejects animated PNG (acTL), animated WebP (VP8X animation bit & ANIM), JPEG MPF, trailing payloads, and polyglot signatures', () => {
    const apngBuf = buildValidPngBuffer({
      extraChunksBeforeIdat: [
        { type: 'acTL', data: Buffer.from([0, 0, 0, 2, 0, 0, 0, 0]) },
      ],
    });
    const apngRes = inspectEditorialImageBinary(apngBuf);
    expect(apngRes.status).toBe('REJECTED');
    if (apngRes.status === 'REJECTED') {
      expect(apngRes.rejectionCode).toBe('ANIMATED_IMAGE_FORBIDDEN');
    }

    const animWebp1 = buildValidWebpLossyBuffer({ animatedVp8x: true });
    const animWebpRes1 = inspectEditorialImageBinary(animWebp1);
    expect(animWebpRes1.status).toBe('REJECTED');
    if (animWebpRes1.status === 'REJECTED') {
      expect(animWebpRes1.rejectionCode).toBe('ANIMATED_IMAGE_FORBIDDEN');
    }

    const animWebp2 = buildValidWebpLossyBuffer({ includeAnimChunk: true });
    const animWebpRes2 = inspectEditorialImageBinary(animWebp2);
    expect(animWebpRes2.status).toBe('REJECTED');
    if (animWebpRes2.status === 'REJECTED') {
      expect(animWebpRes2.rejectionCode).toBe('ANIMATED_IMAGE_FORBIDDEN');
    }

    const mpfJpeg = buildValidJpegBuffer({ includeMpfApp2: true });
    const mpfRes = inspectEditorialImageBinary(mpfJpeg);
    expect(mpfRes.status).toBe('REJECTED');
    if (mpfRes.status === 'REJECTED') {
      expect(mpfRes.rejectionCode).toBe('MULTI_PICTURE_FORBIDDEN');
    }

    const trailingPng = buildValidPngBuffer({
      trailingBytes: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
    });
    const trailingPngRes = inspectEditorialImageBinary(trailingPng);
    expect(trailingPngRes.status).toBe('REJECTED');
    if (trailingPngRes.status === 'REJECTED') {
      expect(trailingPngRes.rejectionCode).toBe(
        'TRAILING_DATA_AFTER_TERMINATOR'
      );
    }

    const trailingJpeg = buildValidJpegBuffer({
      trailingBytes: Buffer.from([0x99, 0x88]),
    });
    const trailingJpegRes = inspectEditorialImageBinary(trailingJpeg);
    expect(trailingJpegRes.status).toBe('REJECTED');
    if (trailingJpegRes.status === 'REJECTED') {
      expect(trailingJpegRes.rejectionCode).toBe(
        'TRAILING_DATA_AFTER_TERMINATOR'
      );
    }

    const trailingWebp = buildValidWebpLossyBuffer({
      trailingBytes: Buffer.from([0x01, 0x02]),
    });
    const trailingWebpRes = inspectEditorialImageBinary(trailingWebp);
    expect(trailingWebpRes.status).toBe('REJECTED');
    if (trailingWebpRes.status === 'REJECTED') {
      expect(trailingWebpRes.rejectionCode).toBe(
        'TRAILING_DATA_AFTER_TERMINATOR'
      );
    }

    const polyglotPng = buildValidPngBuffer({
      extraChunksBeforeIdat: [
        {
          type: 'tEXt',
          data: Buffer.from('Comment\0<script>alert(1)</script>', 'ascii'),
        },
      ],
    });
    const polyglotRes = inspectEditorialImageBinary(polyglotPng);
    expect(polyglotRes.status).toBe('REJECTED');
    if (polyglotRes.status === 'REJECTED') {
      expect(polyglotRes.rejectionCode).toBe('POLYGLOT_SIGNATURE_DETECTED');
    }
  });

  it('screens confidential PDF rights-evidence binaries and rejects missing %%EOF or active/hex-escaped PDF constructs', () => {
    const cleanPdf = buildValidPdfBuffer();
    const cleanRes = inspectRightsEvidenceBinary(cleanPdf, {
      claimedMimeType: 'application/pdf',
      claimedFilenameOrExtension: 'license_agreement.pdf',
    });

    expect(cleanRes.status).toBe('PRELIMINARY_VERIFIED');
    if (cleanRes.status === 'PRELIMINARY_VERIFIED') {
      expect(cleanRes.detectedMimeType).toBe('application/pdf');
      expect(cleanRes.canonicalExtension).toBe('pdf');
      expect(cleanRes.heuristicPdfScreening).toBe(true);
      expect(cleanRes.sanitized).toBe(false);
      expect(cleanRes.fullPixelDecodePerformed).toBe(false);
    }

    const noEofPdf = buildValidPdfBuffer({ omitEof: true });
    const noEofRes = inspectRightsEvidenceBinary(noEofPdf);
    expect(noEofRes.status).toBe('REJECTED');
    if (noEofRes.status === 'REJECTED') {
      expect(noEofRes.rejectionCode).toBe('PDF_MISSING_EOF_OR_XREF');
    }

    const trailingPdf = buildValidPdfBuffer({
      trailingBytes: Buffer.from('HIDDEN_PAYLOAD_AFTER_EOF', 'ascii'),
    });
    const trailingRes = inspectRightsEvidenceBinary(trailingPdf);
    expect(trailingRes.status).toBe('REJECTED');
    if (trailingRes.status === 'REJECTED') {
      expect(trailingRes.rejectionCode).toBe('TRAILING_DATA_AFTER_TERMINATOR');
    }

    for (const activeConstruct of [
      '/JavaScript (app.alert(1))',
      '/JS (evil())',
      '/Launch << /F (cmd.exe) >>',
      '/EmbeddedFiles << >>',
      '/OpenAction << /S /URI /URI (https://example.com) >>',
      '/#4a#61#76#61#53#63#72#69#70#74 (hexEscapedJs)',
    ]) {
      const dangerousPdf = buildValidPdfBuffer({
        injectedBodyText: `1 0 obj\n<< ${activeConstruct} >>\nendobj\n`,
      });
      const res = inspectRightsEvidenceBinary(dangerousPdf);
      expect(res.status).toBe('REJECTED');
      if (res.status === 'REJECTED') {
        expect(res.rejectionCode).toBe('PDF_ACTIVE_CONTENT_DETECTED');
      }
    }
  });
});

describe('IMG-F3-05 — Recoverable Binary Intake Saga & Reconciliation (EditorialBinaryIntakeService)', () => {
  it('completes end-to-end editorial image intake and confidential PDF evidence intake with strict namespace isolation', async () => {
    const {
      intakeService,
      assetRepo,
      rightsService,
      storageAdapter,
      sessionStore,
    } = createTestHarness();

    const pngBytes = buildValidPngBuffer({ width: 1200, height: 800 });
    const imageIntakeRes = await intakeService.ingestEditorialImageBinary(
      makeAuthContext(CONTENT_EDITOR_ADMIN.id),
      {
        intakeId: 'intake_img_001',
        assetId: 'asset_coral_001',
        binary: pngBytes,
        originalFilename: 'coral_001.png',
        claimedMimeType: 'image/png',
        claimedFilenameOrExtension: 'coral_001.png',
        origin: 'news_article',
        altAr: 'موقع مراقبة استعادة الشعاب المرجانية',
        altEn: 'Coral reef restoration monitoring site',
        photographerCredit: 'Dr. Layla Hassan — Red Sea Marine Institute',
        tags: ['coral', 'marine'],
      }
    );

    expect(imageIntakeRes.sessionStatus).toBe('Completed');
    expect(imageIntakeRes.binaryInspectionStatus).toBe('PRELIMINARY_VERIFIED');
    expect(imageIntakeRes.provisionalIdenticalVariants).toBe(true);
    expect(imageIntakeRes.fullPixelDecodePerformed).toBe(false);
    expect(imageIntakeRes.reencodedOrStripped).toBe(false);
    expect(imageIntakeRes.assetRecord.asset.assetId).toBe('asset_coral_001');
    expect(imageIntakeRes.assetRecord.asset.createdByUid).toBe(
      CONTENT_EDITOR_ADMIN.id
    );
    expect(imageIntakeRes.assetRecord.asset.rights.status).toBe(
      'PendingReview'
    );
    expect(imageIntakeRes.assetRecord.asset.sha256Checksum).toBe(
      computeSha256Hex(pngBytes)
    );

    // Quarantine image object must be deleted upon completion; all 5 private variant paths must exist
    const quarantineImgPath = buildQuarantineImageStoragePath(
      'intake_img_001',
      'png'
    );
    expect(await storageAdapter.readMetadata(quarantineImgPath)).toBeNull();
    expect(storageAdapter.getStoredObjectCount()).toBe(5);

    const persistedAsset = await assetRepo.getById('asset_coral_001');
    expect(persistedAsset.status).toBe('FOUND');

    const imgSession = await sessionStore.getSessionById('intake_img_001');
    expect(imgSession?.status).toBe('Completed');
    expect(imgSession?.pendingCleanupObjects).toHaveLength(0);

    // Now ingest a confidential PDF rights-evidence binary for the registered asset
    const pdfBytes = buildValidPdfBuffer();
    const evidenceIntakeRes = await intakeService.ingestRightsEvidenceBinary(
      makeAuthContext(RIGHTS_REVIEWER_ADMIN.id),
      {
        intakeId: 'intake_ev_001',
        assetId: 'asset_coral_001',
        evidenceId: 'ev_coral_001_pdf',
        binary: pdfBytes,
        claimedMimeType: 'application/pdf',
        claimedFilenameOrExtension: 'signed_release.pdf',
        sourceKind: 'SignedLicenseAgreement',
        sourceReference: 'RSMI-2026-LICENSE-0091',
        summary:
          'Signed partner release verified by Rights Officer for editorial publication.',
      }
    );

    expect(evidenceIntakeRes.sessionStatus).toBe('Completed');
    expect(evidenceIntakeRes.binaryInspectionStatus).toBe(
      'PRELIMINARY_VERIFIED'
    );
    expect(evidenceIntakeRes.binaryPreliminarilyInspected).toBe(true);
    expect(evidenceIntakeRes.metadataEvidenceRegistered).toBe(true);
    expect(evidenceIntakeRes.fullSanitizationPerformed).toBe(false);
    expect(evidenceIntakeRes.heuristicPdfScreening).toBe(true);
    expect(evidenceIntakeRes.evidenceRecord.evidenceId).toBe(
      'ev_coral_001_pdf'
    );
    expect(evidenceIntakeRes.evidenceRecord.artifactSha256).toBe(
      computeSha256Hex(pdfBytes)
    );
    expect(evidenceIntakeRes.inspection.detectedMimeType).toBe(
      'application/pdf'
    );
    expect(evidenceIntakeRes.inspection.sizeBytes).toBe(pdfBytes.length);

    // Ensure confidential storage path is never leaked in the evidenceRecord or response JSON
    const serializedResponse = JSON.stringify(evidenceIntakeRes);
    const privateEvPath = buildPrivateRightsEvidenceStoragePath(
      'asset_coral_001',
      'ev_coral_001_pdf',
      'pdf'
    );
    expect(serializedResponse).not.toContain(privateEvPath);
    expect(serializedResponse).not.toContain('editorial_rights_evidence/private');

    // Verify confidential evidence object exists in private storage and quarantine evidence object was cleaned up
    expect(
      await storageAdapter.readMetadata(
        buildQuarantineEvidenceStoragePath('intake_ev_001', 'pdf')
      )
    ).toBeNull();
    const storedEvMeta = await storageAdapter.readMetadata(privateEvPath);
    expect(storedEvMeta).not.toBeNull();
    expect(storedEvMeta?.sha256Checksum).toBe(computeSha256Hex(pdfBytes));

    // Verify the registered evidence record works seamlessly with EditorialImageRightsReviewService approval
    const approvalResult = await rightsService.transitionEditorialImageRights(
      makeAuthContext(RIGHTS_REVIEWER_ADMIN.id),
      {
        assetId: 'asset_coral_001',
        expectedRevision: 1,
        targetStatus: 'Approved',
        evidenceRefs: ['ev_coral_001_pdf'],
        rightsHolder: 'Red Sea Marine Institute',
        licenseType: 'DirectLicense',
        licenseDetails: 'Partner Editorial License RSMI-2026-LICENSE-0091',
        sourceAttributionAr: 'معهد البحر الأحمر لعلوم البحار',
        usageScope: { scopeType: 'GeneralEditorial' },
        reviewReason: 'Verified signed partner permission letter and checksum.',
      }
    );
    expect(approvalResult.record.asset.rights.status).toBe('Approved');
  });

  it('enforces server-side authentication, RBAC permissions, AI exclusion, and rejects spoofed caller fields', async () => {
    const { intakeService } = createTestHarness();
    const pngBytes = buildValidPngBuffer();

    // Unauthenticated
    await expect(
      intakeService.ingestEditorialImageBinary(
        {} as CallableRequestContext,
        {
          intakeId: 'intake_unauth',
          assetId: 'asset_unauth',
          binary: pngBytes,
          originalFilename: 'test.png',
          origin: 'news_article',
          altAr: 'نص بديل',
        }
      )
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    // Viewer cannot ingest editorial images
    await expect(
      intakeService.ingestEditorialImageBinary(
        makeAuthContext(VIEWER_ADMIN.id),
        {
          intakeId: 'intake_viewer',
          assetId: 'asset_viewer',
          binary: pngBytes,
          originalFilename: 'test.png',
          origin: 'news_article',
          altAr: 'نص بديل',
        }
      )
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    // AIAssistant is strictly prohibited
    await expect(
      intakeService.ingestEditorialImageBinary(
        makeAuthContext(AI_ASSISTANT_ADMIN.id),
        {
          intakeId: 'intake_ai',
          assetId: 'asset_ai',
          binary: pngBytes,
          originalFilename: 'test.png',
          origin: 'news_article',
          altAr: 'نص بديل',
        }
      )
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    // ContentEditor cannot ingest confidential rights evidence (requires ManageRights)
    await expect(
      intakeService.ingestRightsEvidenceBinary(
        makeAuthContext(CONTENT_EDITOR_ADMIN.id),
        {
          intakeId: 'intake_ev_forbidden',
          assetId: 'asset_any',
          evidenceId: 'ev_forbidden',
          binary: buildValidPdfBuffer(),
          sourceKind: 'AgencyContractRecord',
          sourceReference: 'INV-2026-01',
          summary: 'Invoice attestation text.',
        }
      )
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    // Reject spoofed server-derived fields on image intake
    await expect(
      intakeService.ingestEditorialImageBinary(
        makeAuthContext(CONTENT_EDITOR_ADMIN.id),
        {
          intakeId: 'intake_spoof_1',
          assetId: 'asset_spoof_1',
          binary: pngBytes,
          originalFilename: 'test.png',
          origin: 'news_article',
          altAr: 'نص بديل',
          createdByUid: 'spoofed_owner',
          sha256Checksum: '0'.repeat(64),
        } as unknown as Parameters<
          typeof intakeService.ingestEditorialImageBinary
        >[1]
      )
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    // Reject spoofed server-derived fields on evidence intake
    await expect(
      intakeService.ingestRightsEvidenceBinary(
        makeAuthContext(RIGHTS_REVIEWER_ADMIN.id),
        {
          intakeId: 'intake_spoof_2',
          assetId: 'asset_spoof_2',
          evidenceId: 'ev_spoof_2',
          binary: buildValidPdfBuffer(),
          sourceKind: 'AgencyContractRecord',
          sourceReference: 'INV-2026-02',
          summary: 'Valid attestation',
          artifactSha256: 'a'.repeat(64),
          recordedByUid: 'spoofed_admin',
        } as unknown as Parameters<
          typeof intakeService.ingestRightsEvidenceBinary
        >[1]
      )
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rolls back quarantine and partial private objects cleanly across stage fault injections without leaving orphans', async () => {
    const { intakeService, assetRepo, storageAdapter, sessionStore } =
      createTestHarness();
    const pngBytes = buildValidPngBuffer();

    // 1. Fail after quarantine write
    intakeService.injectStageFaultOnce({ failAfterQuarantineWrite: true });
    await expect(
      intakeService.ingestEditorialImageBinary(
        makeAuthContext(CONTENT_EDITOR_ADMIN.id),
        {
          intakeId: 'intake_fault_q',
          assetId: 'asset_fault_q',
          binary: pngBytes,
          originalFilename: 'fault_q.png',
          origin: 'news_article',
          altAr: 'نص بديل للصورة',
        }
      )
    ).rejects.toMatchObject({
      code: 'STORAGE_FAILURE',
      sessionStatus: 'Failed',
    });

    expect(storageAdapter.getStoredObjectCount()).toBe(0);
    expect((await sessionStore.getSessionById('intake_fault_q'))?.status).toBe(
      'Failed'
    );

    // 2. Fail mid-way through private variant writes (after 2 of 5 variants written)
    intakeService.injectStageFaultOnce({
      failDuringPrivateWriteAfterCount: 2,
    });
    await expect(
      intakeService.ingestEditorialImageBinary(
        makeAuthContext(CONTENT_EDITOR_ADMIN.id),
        {
          intakeId: 'intake_fault_priv_partial',
          assetId: 'asset_fault_priv_partial',
          binary: pngBytes,
          originalFilename: 'fault_partial.png',
          origin: 'news_article',
          altAr: 'نص بديل للصورة',
        }
      )
    ).rejects.toMatchObject({
      code: 'STORAGE_FAILURE',
      sessionStatus: 'Failed',
    });

    expect(storageAdapter.getStoredObjectCount()).toBe(0);
    expect(
      (await assetRepo.getById('asset_fault_priv_partial')).status
    ).toBe('NOT_FOUND');

    // 3. Fail right before canonical registration after all 5 private variants were written
    intakeService.injectStageFaultOnce({
      failBeforeCanonicalRegistration: true,
    });
    await expect(
      intakeService.ingestEditorialImageBinary(
        makeAuthContext(CONTENT_EDITOR_ADMIN.id),
        {
          intakeId: 'intake_fault_pre_reg',
          assetId: 'asset_fault_pre_reg',
          binary: pngBytes,
          originalFilename: 'fault_pre_reg.png',
          origin: 'news_article',
          altAr: 'نص بديل للصورة',
        }
      )
    ).rejects.toMatchObject({
      code: 'REGISTRATION_FAILURE',
      sessionStatus: 'Failed',
    });

    expect(storageAdapter.getStoredObjectCount()).toBe(0);
    expect((await assetRepo.getById('asset_fault_pre_reg')).status).toBe(
      'NOT_FOUND'
    );
  });

  it('never overwrites or deletes pre-existing private storage objects on assetId or path collision', async () => {
    const { intakeService, storageAdapter } = createTestHarness();
    const originalPng = buildValidPngBuffer({ width: 800, height: 600 });
    const collidingPng = buildValidPngBuffer({ width: 1024, height: 768 });

    // First intake succeeds and creates asset_collision_1 + its 5 private objects
    await intakeService.ingestEditorialImageBinary(
      makeAuthContext(CONTENT_EDITOR_ADMIN.id),
      {
        intakeId: 'intake_first_owner',
        assetId: 'asset_collision_1',
        binary: originalPng,
        originalFilename: 'first.png',
        origin: 'news_article',
        altAr: 'الصورة الأولى المعتمدة',
      }
    );

    const thumbPath = buildEditorialImageVariantStoragePath(
      'asset_collision_1',
      'thumbnail',
      'image/png'
    );
    const beforeMeta = await storageAdapter.readMetadata(thumbPath);
    expect(beforeMeta).not.toBeNull();
    expect(beforeMeta?.ownership.createdByIntakeId).toBe('intake_first_owner');

    // Second intake with a new intakeId attempts to target the same assetId
    await expect(
      intakeService.ingestEditorialImageBinary(
        makeAuthContext(CONTENT_EDITOR_ADMIN.id),
        {
          intakeId: 'intake_second_colliding',
          assetId: 'asset_collision_1',
          binary: collidingPng,
          originalFilename: 'colliding.png',
          origin: 'news_article',
          altAr: 'محاولة تصادم',
        }
      )
    ).rejects.toMatchObject({
      code: 'ASSET_ALREADY_EXISTS',
      sessionStatus: 'Failed',
    });

    // Verify all 5 private objects of asset_collision_1 are still intact with their original generation and checksum
    expect(storageAdapter.getStoredObjectCount()).toBe(5);
    const afterMeta = await storageAdapter.readMetadata(thumbPath);
    expect(afterMeta?.generation).toBe(beforeMeta?.generation);
    expect(afterMeta?.sha256Checksum).toBe(computeSha256Hex(originalPng));

    // Also test direct storage path collision before repository commit (e.g., pre-existing object at variant #3)
    const preOccupiedPath = buildEditorialImageVariantStoragePath(
      'asset_storage_collision_2',
      'article_inline',
      'image/png'
    );
    const preSeededWrite = await storageAdapter.writeIfAbsent({
      storagePath: preOccupiedPath,
      bytes: originalPng,
      contentType: 'image/png',
      sha256Checksum: computeSha256Hex(originalPng),
      ownership: {
        createdByIntakeId: 'other_concurrent_intake',
        targetKind: 'editorial_image_asset',
        namespace: 'private',
        assetId: 'asset_storage_collision_2',
        uploaderUid: OWNER_ADMIN.id,
      },
    });
    expect(preSeededWrite.created).toBe(true);

    await expect(
      intakeService.ingestEditorialImageBinary(
        makeAuthContext(CONTENT_EDITOR_ADMIN.id),
        {
          intakeId: 'intake_hits_preoccupied_path',
          assetId: 'asset_storage_collision_2',
          binary: collidingPng,
          originalFilename: 'colliding_path.png',
          origin: 'news_article',
          altAr: 'تصادم مسار التخزين',
        }
      )
    ).rejects.toMatchObject({
      code: 'STORAGE_CONFLICT',
      sessionStatus: 'Failed',
    });

    // Variants 1 & 2 created by 'intake_hits_preoccupied_path' were rolled back,
    // while 'preOccupiedPath' owned by 'other_concurrent_intake' was NOT deleted!
    const survivingPreSeeded =
      await storageAdapter.readMetadata(preOccupiedPath);
    expect(survivingPreSeeded).not.toBeNull();
    expect(survivingPreSeeded?.ownership.createdByIntakeId).toBe(
      'other_concurrent_intake'
    );
    expect(storageAdapter.getStoredObjectCount()).toBe(6); // 5 from asset_collision_1 + 1 surviving preOccupiedPath
  });

  it('recovers from lost-commit / post-registration interruption by reading back canonical state and preserving private objects', async () => {
    const { intakeService, assetRepo, storageAdapter, sessionStore } =
      createTestHarness();
    const pngBytes = buildValidPngBuffer({ width: 1000, height: 1000 });

    // Simulate a lost commit acknowledgement AFTER canonical asset registration succeeded
    intakeService.injectStageFaultOnce({
      failAfterCanonicalRegistrationUnknownOutcome: true,
    });

    await expect(
      intakeService.ingestEditorialImageBinary(
        makeAuthContext(CONTENT_EDITOR_ADMIN.id),
        {
          intakeId: 'intake_lost_commit_1',
          assetId: 'asset_lost_commit_1',
          binary: pngBytes,
          originalFilename: 'lost_commit.png',
          origin: 'news_article',
          altAr: 'صورة اختبار انقطاع التأكيد بعد الحفظ',
        }
      )
    ).rejects.toMatchObject({
      code: 'RECONCILIATION_REQUIRED',
      sessionStatus: 'NeedsReconciliation',
    });

    // Canonical asset WAS committed, and neither private objects (5) nor quarantine object (1) were rashly deleted
    expect((await assetRepo.getById('asset_lost_commit_1')).status).toBe(
      'FOUND'
    );
    expect(storageAdapter.getStoredObjectCount()).toBe(6);

    const interruptedSession = await sessionStore.getSessionById(
      'intake_lost_commit_1'
    );
    expect(interruptedSession?.status).toBe('NeedsReconciliation');

    // Run reconcileIntake: it must verify the canonical asset exists, preserve all 5 private objects,
    // delete the 1 quarantine object, and transition the session to Completed!
    const reconcileRes = await intakeService.reconcileIntake(
      'intake_lost_commit_1'
    );
    expect(reconcileRes.previousStatus).toBe('NeedsReconciliation');
    expect(reconcileRes.currentStatus).toBe('Completed');
    expect(reconcileRes.canonicalRegistrationVerified).toBe(true);
    expect(reconcileRes.deletedObjectsCount).toBe(1);
    expect(reconcileRes.remainingCleanupObjectsCount).toBe(0);
    expect(storageAdapter.getStoredObjectCount()).toBe(5);

    // Calling reconcileIntake a second time is strictly idempotent
    const secondReconcile = await intakeService.reconcileIntake(
      'intake_lost_commit_1'
    );
    expect(secondReconcile.currentStatus).toBe('Completed');
    expect(secondReconcile.deletedObjectsCount).toBe(0);
    expect(storageAdapter.getStoredObjectCount()).toBe(5);
  });

  it('tracks CleanupPending when rollback delete or quarantine delete fails and completes cleanup on reconciliation', async () => {
    const { intakeService, storageAdapter, sessionStore } = createTestHarness();
    const pngBytes = buildValidPngBuffer();

    // Case 1: Registration fails AND rollback cleanup fails on first object -> status is CleanupPending (not Failed)
    intakeService.injectStageFaultOnce({
      failBeforeCanonicalRegistration: true,
      failDuringRollbackCleanup: true,
    });

    await expect(
      intakeService.ingestEditorialImageBinary(
        makeAuthContext(CONTENT_EDITOR_ADMIN.id),
        {
          intakeId: 'intake_cleanup_pending_fail',
          assetId: 'asset_cleanup_pending_fail',
          binary: pngBytes,
          originalFilename: 'cleanup_fail.png',
          origin: 'news_article',
          altAr: 'صورة اختبار تعذر الحذف المؤقت',
        }
      )
    ).rejects.toMatchObject({
      code: 'REGISTRATION_FAILURE',
      sessionStatus: 'CleanupPending',
    });

    const pendingRollbackSession = await sessionStore.getSessionById(
      'intake_cleanup_pending_fail'
    );
    expect(pendingRollbackSession?.status).toBe('CleanupPending');
    expect(pendingRollbackSession?.pendingCleanupObjects.length).toBe(1);
    expect(storageAdapter.getStoredObjectCount()).toBe(1);

    // Reconcile expired/pending intakes -> deletes the remaining object and transitions to Failed
    const batchOutcomes = await intakeService.reconcileExpiredIntakes();
    expect(batchOutcomes).toHaveLength(1);
    expect(batchOutcomes[0].intakeId).toBe('intake_cleanup_pending_fail');
    expect(batchOutcomes[0].currentStatus).toBe('Failed');
    expect(batchOutcomes[0].deletedObjectsCount).toBe(1);
    expect(storageAdapter.getStoredObjectCount()).toBe(0);

    // Case 2: Registration succeeds, but quarantine cleanup fails -> status is CleanupPending, then Completed after reconciliation
    intakeService.injectStageFaultOnce({
      failDuringQuarantineCleanup: true,
    });

    const resWithPendingQuarantine =
      await intakeService.ingestEditorialImageBinary(
        makeAuthContext(CONTENT_EDITOR_ADMIN.id),
        {
          intakeId: 'intake_quarantine_retry',
          assetId: 'asset_quarantine_retry',
          binary: pngBytes,
          originalFilename: 'quarantine_retry.png',
          origin: 'news_article',
          altAr: 'صورة اختبار إعادة تنظيف الحجر',
        }
      );

    expect(resWithPendingQuarantine.sessionStatus).toBe('CleanupPending');
    expect(storageAdapter.getStoredObjectCount()).toBe(6); // 5 private + 1 uncleaned quarantine

    const recQuarantine = await intakeService.reconcileIntake(
      'intake_quarantine_retry'
    );
    expect(recQuarantine.previousStatus).toBe('CleanupPending');
    expect(recQuarantine.currentStatus).toBe('Completed');
    expect(recQuarantine.canonicalRegistrationVerified).toBe(true);
    expect(recQuarantine.deletedObjectsCount).toBe(1);
    expect(storageAdapter.getStoredObjectCount()).toBe(5); // Only the 5 private variants remain
  });

  it('prevents intakeId reuse across different assets, actors, or binary payloads', async () => {
    const { intakeService } = createTestHarness();
    const pngBytes = buildValidPngBuffer();

    await intakeService.ingestEditorialImageBinary(
      makeAuthContext(CONTENT_EDITOR_ADMIN.id),
      {
        intakeId: 'intake_bound_1',
        assetId: 'asset_bound_1',
        binary: pngBytes,
        originalFilename: 'bound_1.png',
        origin: 'news_article',
        altAr: 'صورة مرتبطة بمعرف جلسة',
      }
    );

    let caughtError: unknown;
    try {
      await intakeService.ingestEditorialImageBinary(
        makeAuthContext(OWNER_ADMIN.id),
        {
          intakeId: 'intake_bound_1',
          assetId: 'asset_bound_2',
          binary: pngBytes,
          originalFilename: 'bound_2.png',
          origin: 'news_article',
          altAr: 'محاولة إعادة استخدام المعرف لأصل مختلف',
        }
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(EditorialBinaryIntakeError);
    expect((caughtError as EditorialBinaryIntakeError).code).toBe(
      'INTAKE_ID_CONFLICT'
    );
  });

  it('reconciles abandoned non-terminal Quarantined/Promoting sessions after expiresAt with generation/ownership-safe cleanup, conservative failure handling, and idempotency', async () => {
    const { intakeService, storageAdapter, sessionStore } = createTestHarness();
    const pngBytes = buildValidPngBuffer({ width: 800, height: 600 });

    // Intercept sessionStore.updateSession to simulate an unhandled worker interruption
    // right after the session is persisted in non-terminal 'Promoting' status with all 5 private objects tracked.
    const originalUpdateSession = sessionStore.updateSession.bind(sessionStore);
    let abortOnPromotingWithPrivateObjects = true;
    sessionStore.updateSession = async (session, expectedRevision) => {
      const updated = await originalUpdateSession(session, expectedRevision);
      if (
        abortOnPromotingWithPrivateObjects &&
        updated.status === 'Promoting' &&
        updated.createdPrivateObjects.length === 5
      ) {
        abortOnPromotingWithPrivateObjects = false;
        throw new Error(
          'Simulated abrupt worker interruption during Promoting stage.'
        );
      }
      return updated;
    };

    await expect(
      intakeService.ingestEditorialImageBinary(
        makeAuthContext(CONTENT_EDITOR_ADMIN.id),
        {
          intakeId: 'intake_abandoned_promoting',
          assetId: 'asset_abandoned_promoting',
          binary: pngBytes,
          originalFilename: 'abandoned.png',
          origin: 'news_article',
          altAr: 'جلسة متروكة في مرحلة الترقية',
        }
      )
    ).rejects.toThrow(
      'Simulated abrupt worker interruption during Promoting stage.'
    );

    const abandonedSession = await sessionStore.getSessionById(
      'intake_abandoned_promoting'
    );
    expect(abandonedSession).not.toBeNull();
    expect(abandonedSession?.status).toBe('Promoting');
    expect(abandonedSession?.createdQuarantineObjects).toHaveLength(1);
    expect(abandonedSession?.createdPrivateObjects).toHaveLength(5);
    expect(storageAdapter.getStoredObjectCount()).toBe(6); // 1 quarantine + 5 private

    // 1. Before expiresAt (sessionTtlMs = 15 minutes): reconcileExpiredIntakes does NOT touch active Promoting session
    const beforeExpiryIso = new Date(
      Date.parse(abandonedSession!.createdAt) + 5 * 60 * 1000
    ).toISOString();
    const earlyOutcomes = await intakeService.reconcileExpiredIntakes({
      nowIso: beforeExpiryIso,
    });
    expect(earlyOutcomes).toHaveLength(0);
    expect(storageAdapter.getStoredObjectCount()).toBe(6);

    // 2. Also verify generation/ownership safety during expired cleanup:
    // Replace one of the 5 private paths ('thumbnail') with an object owned by a different intake/generation,
    // and inject a transient delete failure on the 'card' variant path to test conservative CleanupPending handling.
    const thumbPath = buildEditorialImageVariantStoragePath(
      'asset_abandoned_promoting',
      'thumbnail',
      'image/png'
    );
    const cardPath = buildEditorialImageVariantStoragePath(
      'asset_abandoned_promoting',
      'card',
      'image/png'
    );
    const thumbTracked = abandonedSession!.createdPrivateObjects.find(
      (o) => o.storagePath === thumbPath
    )!;
    await storageAdapter.deleteIfGenerationMatches({
      storagePath: thumbPath,
      expectedGeneration: thumbTracked.generation,
      expectedIntakeId: 'intake_abandoned_promoting',
    });
    const foreignWrite = await storageAdapter.writeIfAbsent({
      storagePath: thumbPath,
      bytes: pngBytes,
      contentType: 'image/png',
      sha256Checksum: computeSha256Hex(pngBytes),
      ownership: {
        createdByIntakeId: 'other_legitimate_intake',
        targetKind: 'editorial_image_asset',
        namespace: 'private',
        assetId: 'asset_abandoned_promoting',
        uploaderUid: OWNER_ADMIN.id,
      },
    });
    expect(foreignWrite.created).toBe(true);

    storageAdapter.failDeleteForPathOnce(cardPath);

    // Advance controlled nowIso beyond expiresAt (+16 minutes)
    const afterExpiryIso = new Date(
      Date.parse(abandonedSession!.expiresAt) + 60 * 1000
    ).toISOString();

    const firstExpiredRun = await intakeService.reconcileExpiredIntakes({
      nowIso: afterExpiryIso,
    });
    expect(firstExpiredRun).toHaveLength(1);
    expect(firstExpiredRun[0].intakeId).toBe('intake_abandoned_promoting');
    expect(firstExpiredRun[0].previousStatus).toBe('Promoting');
    // Because 'card' delete failed once, session transitions conservatively to CleanupPending
    expect(firstExpiredRun[0].currentStatus).toBe('CleanupPending');
    expect(firstExpiredRun[0].canonicalRegistrationVerified).toBe(false);
    // 4 owned objects deleted (1 quarantine + 3 private variants); 'thumbnail' skipped due to ownership/generation mismatch; 'card' pending retry
    expect(firstExpiredRun[0].deletedObjectsCount).toBe(4);
    expect(firstExpiredRun[0].remainingCleanupObjectsCount).toBe(1);

    // Foreign-owned object at thumbPath MUST remain untouched
    const survivingForeignMeta = await storageAdapter.readMetadata(thumbPath);
    expect(survivingForeignMeta?.ownership.createdByIntakeId).toBe(
      'other_legitimate_intake'
    );

    // 3. Second reconciliation run completes the pending 'card' delete and transitions to Failed
    const secondExpiredRun = await intakeService.reconcileExpiredIntakes({
      nowIso: afterExpiryIso,
    });
    expect(secondExpiredRun).toHaveLength(1);
    expect(secondExpiredRun[0].previousStatus).toBe('CleanupPending');
    expect(secondExpiredRun[0].currentStatus).toBe('Failed');
    expect(secondExpiredRun[0].deletedObjectsCount).toBe(1);
    expect(secondExpiredRun[0].remainingCleanupObjectsCount).toBe(0);

    // Only the 1 foreign-owned object remains in storage
    expect(storageAdapter.getStoredObjectCount()).toBe(1);

    // 4. Repeated reconciliation is strictly idempotent
    const thirdExpiredRun = await intakeService.reconcileExpiredIntakes({
      nowIso: afterExpiryIso,
    });
    expect(thirdExpiredRun).toHaveLength(0);

    const directReconcile = await intakeService.reconcileIntake(
      'intake_abandoned_promoting'
    );
    expect(directReconcile.currentStatus).toBe('Failed');
    expect(directReconcile.deletedObjectsCount).toBe(0);
    expect(storageAdapter.getStoredObjectCount()).toBe(1);
  });

  it('recovers from rights evidence lost-commit via authoritative read-back and preserves private evidence files when outcome cannot be proven', async () => {
    const {
      clock,
      adminRepo,
      assetRepo,
      rightsRunner,
      rightsService,
      storageAdapter,
      sessionStore,
      intakeService,
    } = createTestHarness();

    const pngBytes = buildValidPngBuffer({ width: 1000, height: 800 });
    await intakeService.ingestEditorialImageBinary(
      makeAuthContext(CONTENT_EDITOR_ADMIN.id),
      {
        intakeId: 'intake_img_for_ev_recovery',
        assetId: 'asset_for_ev_recovery',
        binary: pngBytes,
        originalFilename: 'ev_recovery_base.png',
        origin: 'news_article',
        altAr: 'صورة لاختبار استرداد أدلة الحقوق',
      }
    );
    expect(storageAdapter.getStoredObjectCount()).toBe(5);

    const pdfBytes = buildValidPdfBuffer();
    const expectedPdfSha256 = computeSha256Hex(pdfBytes);

    // Part 1: Canonical evidence registration succeeds, followed by ambiguous response / timeout
    intakeService.injectStageFaultOnce({
      failAfterCanonicalRegistrationUnknownOutcome: true,
    });

    await expect(
      intakeService.ingestRightsEvidenceBinary(
        makeAuthContext(RIGHTS_REVIEWER_ADMIN.id),
        {
          intakeId: 'intake_ev_lost_commit_1',
          assetId: 'asset_for_ev_recovery',
          evidenceId: 'ev_lost_commit_1',
          binary: pdfBytes,
          claimedMimeType: 'application/pdf',
          claimedFilenameOrExtension: 'release_lost_commit.pdf',
          sourceKind: 'SignedLicenseAgreement',
          sourceReference: 'REL-2026-LOST-1',
          summary: 'Signed license release with simulated lost commit response.',
        }
      )
    ).rejects.toMatchObject({
      code: 'RECONCILIATION_REQUIRED',
      sessionStatus: 'NeedsReconciliation',
    });

    // Authoritative evidence read-back matches evidenceId, assetId, and artifactSha256
    const persistedEv = await rightsRunner.getEvidenceRecord('ev_lost_commit_1');
    expect(persistedEv).not.toBeNull();
    expect(persistedEv?.evidenceId).toBe('ev_lost_commit_1');
    expect(persistedEv?.assetId).toBe('asset_for_ev_recovery');
    expect(persistedEv?.artifactSha256).toBe(expectedPdfSha256);
    expect(persistedEv?.recordedByUid).toBe(RIGHTS_REVIEWER_ADMIN.id);

    const privateEvPath1 = buildPrivateRightsEvidenceStoragePath(
      'asset_for_ev_recovery',
      'ev_lost_commit_1',
      'pdf'
    );
    const quarantineEvPath1 = buildQuarantineEvidenceStoragePath(
      'intake_ev_lost_commit_1',
      'pdf'
    );

    // Both private evidence object and quarantine object still exist prior to reconciliation
    expect(await storageAdapter.readMetadata(privateEvPath1)).not.toBeNull();
    expect(await storageAdapter.readMetadata(quarantineEvPath1)).not.toBeNull();

    // Reconcile: preserves matching private evidence object, cleans up quarantine object, transitions to Completed
    const evReconcile1 = await intakeService.reconcileIntake(
      'intake_ev_lost_commit_1'
    );
    expect(evReconcile1.previousStatus).toBe('NeedsReconciliation');
    expect(evReconcile1.currentStatus).toBe('Completed');
    expect(evReconcile1.canonicalRegistrationVerified).toBe(true);
    expect(evReconcile1.deletedObjectsCount).toBe(1);
    expect(evReconcile1.remainingCleanupObjectsCount).toBe(0);

    expect(await storageAdapter.readMetadata(privateEvPath1)).not.toBeNull();
    expect(await storageAdapter.readMetadata(quarantineEvPath1)).toBeNull();

    // Repeated reconciliation is idempotent
    const evReconcile2 = await intakeService.reconcileIntake(
      'intake_ev_lost_commit_1'
    );
    expect(evReconcile2.currentStatus).toBe('Completed');
    expect(evReconcile2.deletedObjectsCount).toBe(0);
    expect(await storageAdapter.readMetadata(privateEvPath1)).not.toBeNull();

    // Part 2: When canonical success cannot be proven (post-commit read-back throws or is unavailable),
    // require NeedsReconciliation and NEVER destructively delete potentially registered private files!
    let lookupCallCount = 0;
    const intakeServiceWithFailingPostCommitReadback =
      new EditorialBinaryIntakeService({
        adminRepository: adminRepo,
        assetRepository: assetRepo,
        rightsEvidenceBridge: rightsService,
        storageAdapter,
        sessionStore,
        evidenceLookup: async (id: string) => {
          lookupCallCount += 1;
          if (lookupCallCount === 1) {
            // Pre-check before storage write succeeds (not yet registered)
            return rightsRunner.getEvidenceRecord(id);
          }
          // Post-commit read-back after ambiguous registration response fails!
          throw new Error('Read-back database temporarily unreachable');
        },
        clock,
      });

    intakeServiceWithFailingPostCommitReadback.injectStageFaultOnce({
      failAfterCanonicalRegistrationUnknownOutcome: true,
    });

    await expect(
      intakeServiceWithFailingPostCommitReadback.ingestRightsEvidenceBinary(
        makeAuthContext(RIGHTS_REVIEWER_ADMIN.id),
        {
          intakeId: 'intake_ev_unprovable_1',
          assetId: 'asset_for_ev_recovery',
          evidenceId: 'ev_unprovable_1',
          binary: pdfBytes,
          claimedMimeType: 'application/pdf',
          claimedFilenameOrExtension: 'release_unprovable.pdf',
          sourceKind: 'PhotographerWrittenRelease',
          sourceReference: 'REL-2026-UNPROVABLE-1',
          summary:
            'Written release where post-commit read-back proof is temporarily unavailable.',
        }
      )
    ).rejects.toMatchObject({
      code: 'RECONCILIATION_REQUIRED',
      sessionStatus: 'NeedsReconciliation',
    });

    const unprovableSession = await sessionStore.getSessionById(
      'intake_ev_unprovable_1'
    );
    expect(unprovableSession?.status).toBe('NeedsReconciliation');
    expect(unprovableSession?.registrationOutcomeUnknown).toBe(true);

    // Private evidence file MUST be preserved (never deleted on unknown outcome)
    const privateEvPath2 = buildPrivateRightsEvidenceStoragePath(
      'asset_for_ev_recovery',
      'ev_unprovable_1',
      'pdf'
    );
    expect(await storageAdapter.readMetadata(privateEvPath2)).not.toBeNull();
  });
});
