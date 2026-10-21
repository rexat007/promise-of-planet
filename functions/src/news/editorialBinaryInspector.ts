import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  DEFAULT_ASSET_VALIDATION_LIMITS,
  MAX_IMAGE_DIMENSION_PX,
  type EditorialImageAssetVariantFormat,
} from '../types/editorialImageAsset';

export type EditorialImageRightEvidenceFileMimeType =
  | 'application/pdf'
  | EditorialImageAssetVariantFormat;

/**
 * IMG-F3-05 — Honest Preliminary Binary Inspector
 *
 * SECURITY & ARCHITECTURAL DISCLOSURE:
 * This module performs synchronous, bounded, zero-dependency binary header,
 * container structure, chunk CRC/length, dimension, pixel-budget, and heuristic
 * token inspection in pure Node.js (`Buffer` + `node:crypto`).
 *
 * It intentionally DOES NOT claim `SAFE`, `MALWARE_FREE`, `FULLY_VALIDATED`,
 * or `PRODUCTION_READY` status. Full pixel-stream decompression, ICC/EXIF
 * metadata stripping, re-encoding into canonical media variants, and isolated
 * PDF flattening/rendering require a dedicated native media worker in a
 * subsequent phase.
 */

export type EditorialBinaryInspectionVerdict =
  | 'PRELIMINARY_VERIFIED'
  | 'REJECTED';

export type EditorialBinaryRejectionCode =
  | 'INVALID_BUFFER'
  | 'EMPTY_BINARY'
  | 'SIZE_LIMIT_EXCEEDED'
  | 'UNSUPPORTED_MAGIC_BYTES'
  | 'CLAIMED_MIME_MISMATCH'
  | 'CLAIMED_EXTENSION_MISMATCH'
  | 'CORRUPTED_HEADER_OR_STRUCTURE'
  | 'INVALID_CHUNK_CRC'
  | 'INVALID_DIMENSIONS'
  | 'AXIS_DIMENSION_EXCEEDED'
  | 'TOTAL_PIXEL_BUDGET_EXCEEDED'
  | 'ANIMATED_IMAGE_FORBIDDEN'
  | 'MULTI_PICTURE_FORBIDDEN'
  | 'TRAILING_DATA_AFTER_TERMINATOR'
  | 'POLYGLOT_SIGNATURE_DETECTED'
  | 'PDF_MISSING_EOF_OR_XREF'
  | 'PDF_ACTIVE_CONTENT_DETECTED';

export interface EditorialImageInspectionPolicy {
  readonly maxSizeBytes: number;
  readonly minDimensionPx: number;
  readonly maxDimensionPx: number;
  /**
   * Stricter preliminary intake pixel budget (`25,000,000` pixels by default)
   * compared to the theoretical `10,000 x 10,000 = 100,000,000` maximum axis
   * product allowed by `editorialImageAssetContract.ts`. This limits memory
   * amplification before a native media re-encoding worker is introduced.
   */
  readonly maxTotalPixels: number;
  readonly maxPngChunks: number;
  readonly maxJpegSegments: number;
  readonly maxWebpChunks: number;
}

export const DEFAULT_IMAGE_INSPECTION_POLICY: EditorialImageInspectionPolicy =
  Object.freeze({
    maxSizeBytes: DEFAULT_ASSET_VALIDATION_LIMITS.maxSizeBytes, // 15,000,000 bytes
    minDimensionPx: 1, // 1 px minimum per axis
    maxDimensionPx:
      DEFAULT_ASSET_VALIDATION_LIMITS.maxDimensionPx ?? MAX_IMAGE_DIMENSION_PX, // 10,000 px
    maxTotalPixels: 25_000_000, // 25 MP conservative intake policy limit
    maxPngChunks: 2048,
    maxJpegSegments: 2048,
    maxWebpChunks: 512,
  });

export const DEFAULT_EVIDENCE_INSPECTION_POLICY: EditorialImageInspectionPolicy =
  Object.freeze({
    ...DEFAULT_IMAGE_INSPECTION_POLICY,
  });

export interface InspectEditorialImageBinaryOptions {
  readonly claimedMimeType?: string;
  readonly claimedFilenameOrExtension?: string;
  readonly policy?: Partial<EditorialImageInspectionPolicy>;
}

export interface InspectRightsEvidenceBinaryOptions {
  readonly claimedMimeType?: string;
  readonly claimedFilenameOrExtension?: string;
  readonly policy?: Partial<EditorialImageInspectionPolicy>;
}

export interface EditorialImageBinaryVerifiedResult {
  readonly status: 'PRELIMINARY_VERIFIED';
  readonly targetKind: 'editorial_image_asset';
  readonly detectedMimeType: EditorialImageAssetVariantFormat;
  readonly canonicalExtension: 'png' | 'jpg' | 'webp';
  readonly sizeBytes: number;
  readonly sha256Checksum: string;
  readonly width: number;
  readonly height: number;
  readonly totalPixels: number;
  readonly aspectRatio: number;
  readonly animated: false;
  readonly fullPixelDecodePerformed: false;
  readonly reencodedOrStripped: false;
  readonly inspectionNotes: readonly string[];
}

export interface EditorialBinaryRejectedResult {
  readonly status: 'REJECTED';
  readonly targetKind: 'editorial_image_asset' | 'rights_evidence_binary';
  readonly rejectionCode: EditorialBinaryRejectionCode;
  readonly rejectionReason: string;
  readonly detectedMimeType: string | null;
  readonly sizeBytes: number;
  readonly sha256Checksum: string | null;
}

export type EditorialImageBinaryInspectionResult =
  | EditorialImageBinaryVerifiedResult
  | EditorialBinaryRejectedResult;

export interface RightsEvidenceBinaryVerifiedResult {
  readonly status: 'PRELIMINARY_VERIFIED';
  readonly targetKind: 'rights_evidence_binary';
  readonly detectedMimeType: EditorialImageRightEvidenceFileMimeType;
  readonly canonicalExtension: 'pdf' | 'png' | 'jpg' | 'webp';
  readonly sizeBytes: number;
  readonly sha256Checksum: string;
  readonly width?: number;
  readonly height?: number;
  readonly totalPixels?: number;
  readonly aspectRatio?: number;
  readonly heuristicPdfScreening: boolean;
  readonly fullPixelDecodePerformed: false;
  readonly sanitized: false;
  readonly inspectionNotes: readonly string[];
}

export type RightsEvidenceBinaryInspectionResult =
  | RightsEvidenceBinaryVerifiedResult
  | EditorialBinaryRejectedResult;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RIFF_MAGIC = Buffer.from('RIFF', 'ascii');
const WEBP_MAGIC = Buffer.from('WEBP', 'ascii');
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

/**
 * Precomputed IEEE 802.3 CRC-32 lookup table for PNG chunk integrity checks.
 */
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(
  buffer: Buffer,
  startOffset: number,
  endOffsetExclusive: number
): number {
  let crc = 0xffffffff;
  for (let i = startOffset; i < endOffsetExclusive; i += 1) {
    const byte = buffer[i];
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function computeSha256Hex(input: Buffer | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex').toLowerCase();
}

function resolvePolicy(
  base: EditorialImageInspectionPolicy,
  overrides?: Partial<EditorialImageInspectionPolicy>
): EditorialImageInspectionPolicy {
  if (!overrides) {
    return base;
  }
  return {
    maxSizeBytes: overrides.maxSizeBytes ?? base.maxSizeBytes,
    minDimensionPx: overrides.minDimensionPx ?? base.minDimensionPx,
    maxDimensionPx: overrides.maxDimensionPx ?? base.maxDimensionPx,
    maxTotalPixels: overrides.maxTotalPixels ?? base.maxTotalPixels,
    maxPngChunks: overrides.maxPngChunks ?? base.maxPngChunks,
    maxJpegSegments: overrides.maxJpegSegments ?? base.maxJpegSegments,
    maxWebpChunks: overrides.maxWebpChunks ?? base.maxWebpChunks,
  };
}

function toNodeBuffer(input: unknown): Buffer | null {
  if (Buffer.isBuffer(input)) {
    return input;
  }
  if (input instanceof Uint8Array) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  return null;
}

function extractNormalizedExtension(filenameOrExtension: string): string {
  const trimmed = filenameOrExtension.trim().toLowerCase();
  if (!trimmed) {
    return '';
  }
  const lastDotIndex = trimmed.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return trimmed;
  }
  return trimmed.slice(lastDotIndex + 1);
}

function matchesClaimedExtension(
  detectedMimeType: EditorialImageRightEvidenceFileMimeType,
  claimedFilenameOrExtension: string
): boolean {
  const ext = extractNormalizedExtension(claimedFilenameOrExtension);
  if (!ext) {
    return false;
  }
  switch (detectedMimeType) {
    case 'image/png':
      return ext === 'png';
    case 'image/jpeg':
      return ext === 'jpg' || ext === 'jpeg';
    case 'image/webp':
      return ext === 'webp';
    case 'application/pdf':
      return ext === 'pdf';
    default:
      return false;
  }
}

function detectMagicMimeType(
  buffer: Buffer,
  allowPdf: boolean
): {
  mimeType: EditorialImageRightEvidenceFileMimeType;
  canonicalExtension: 'png' | 'jpg' | 'webp' | 'pdf';
} | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(PNG_MAGIC)
  ) {
    return { mimeType: 'image/png', canonicalExtension: 'png' };
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { mimeType: 'image/jpeg', canonicalExtension: 'jpg' };
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).equals(RIFF_MAGIC) &&
    buffer.subarray(8, 12).equals(WEBP_MAGIC)
  ) {
    return { mimeType: 'image/webp', canonicalExtension: 'webp' };
  }

  if (
    allowPdf &&
    buffer.length >= 5 &&
    buffer.subarray(0, 5).equals(PDF_MAGIC)
  ) {
    return { mimeType: 'application/pdf', canonicalExtension: 'pdf' };
  }

  return null;
}

const IMAGE_POLYGLOT_LOWERCASE_PATTERNS: readonly Buffer[] = [
  Buffer.from('<script', 'ascii'),
  Buffer.from('<html', 'ascii'),
  Buffer.from('<!doctype html', 'ascii'),
  Buffer.from('<svg', 'ascii'),
  Buffer.from('javascript:', 'ascii'),
  Buffer.from('vbscript:', 'ascii'),
  Buffer.from('onload=', 'ascii'),
  Buffer.from('onerror=', 'ascii'),
];

const IMAGE_POLYGLOT_EXACT_PATTERNS: readonly {
  readonly pattern: Buffer;
  readonly label: string;
}[] = [
  { pattern: Buffer.from('%PDF-', 'ascii'), label: 'embedded PDF header' },
  {
    pattern: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    label: 'embedded ZIP/JAR local file header',
  },
];

function detectImagePolyglotIndicators(buffer: Buffer): string | null {
  // Scan ASCII-lowercased copy for script/HTML/SVG polyglot markers
  const lowerBuf = Buffer.allocUnsafe(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    const b = buffer[i];
    lowerBuf[i] = b >= 0x41 && b <= 0x5a ? b + 0x20 : b;
  }

  for (const marker of IMAGE_POLYGLOT_LOWERCASE_PATTERNS) {
    if (lowerBuf.indexOf(marker) !== -1) {
      return `Detected polyglot script/markup signature (${marker.toString('ascii')}) inside image binary.`;
    }
  }

  for (const { pattern, label } of IMAGE_POLYGLOT_EXACT_PATTERNS) {
    if (buffer.indexOf(pattern) !== -1) {
      return `Detected polyglot container signature (${label}) inside image binary.`;
    }
  }

  return null;
}

interface ParsedImageStructure {
  readonly ok: true;
  readonly width: number;
  readonly height: number;
  readonly notes: readonly string[];
}

interface ParsedStructureFailure {
  readonly ok: false;
  readonly code: EditorialBinaryRejectionCode;
  readonly reason: string;
}

type ImageStructureParseOutcome = ParsedImageStructure | ParsedStructureFailure;

function isValidPngColorAndBitDepth(
  colorType: number,
  bitDepth: number
): boolean {
  switch (colorType) {
    case 0: // Grayscale
      return (
        bitDepth === 1 ||
        bitDepth === 2 ||
        bitDepth === 4 ||
        bitDepth === 8 ||
        bitDepth === 16
      );
    case 2: // Truecolor
    case 4: // Grayscale + Alpha
    case 6: // Truecolor + Alpha
      return bitDepth === 8 || bitDepth === 16;
    case 3: // Indexed-color
      return (
        bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8
      );
    default:
      return false;
  }
}

function parsePngStructure(
  buffer: Buffer,
  policy: EditorialImageInspectionPolicy
): ImageStructureParseOutcome {
  // Minimum valid PNG: 8 (magic) + 25 (IHDR) + 12 (IDAT) + 12 (IEND) = 57 bytes
  if (buffer.length < 57) {
    return {
      ok: false,
      code: 'CORRUPTED_HEADER_OR_STRUCTURE',
      reason: 'PNG binary is shorter than the minimum valid PNG structure.',
    };
  }

  let offset = 8;
  let chunkIndex = 0;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;
  let width = 0;
  let height = 0;

  while (offset < buffer.length) {
    chunkIndex += 1;
    if (chunkIndex > policy.maxPngChunks) {
      return {
        ok: false,
        code: 'CORRUPTED_HEADER_OR_STRUCTURE',
        reason: `PNG chunk count exceeded maximum limit of ${policy.maxPngChunks}.`,
      };
    }

    if (offset + 8 > buffer.length) {
      return {
        ok: false,
        code: 'CORRUPTED_HEADER_OR_STRUCTURE',
        reason: 'Truncated PNG chunk header.',
      };
    }

    const chunkLength = buffer.readUInt32BE(offset);
    if (chunkLength > 0x7fffffff) {
      return {
        ok: false,
        code: 'CORRUPTED_HEADER_OR_STRUCTURE',
        reason: 'Invalid PNG chunk length exceeding 31-bit unsigned limit.',
      };
    }

    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const crcEnd = dataEnd + 4;

    if (crcEnd > buffer.length) {
      return {
        ok: false,
        code: 'CORRUPTED_HEADER_OR_STRUCTURE',
        reason: 'Truncated PNG chunk payload or CRC.',
      };
    }

    // Validate chunk type is 4 ASCII letters
    for (let i = typeStart; i < dataStart; i += 1) {
      const byte = buffer[i];
      const isUpper = byte >= 0x41 && byte <= 0x5a;
      const isLower = byte >= 0x61 && byte <= 0x7a;
      if (!isUpper && !isLower) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'Invalid non-ASCII PNG chunk type.',
        };
      }
    }

    const chunkType = buffer.toString('ascii', typeStart, dataStart);
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const computedCrc = computeCrc32(buffer, typeStart, dataEnd);
    if (expectedCrc !== computedCrc) {
      return {
        ok: false,
        code: 'INVALID_CHUNK_CRC',
        reason: `PNG chunk "${chunkType}" failed CRC-32 integrity check.`,
      };
    }

    if (chunkIndex === 1 && chunkType !== 'IHDR') {
      return {
        ok: false,
        code: 'CORRUPTED_HEADER_OR_STRUCTURE',
        reason: 'First PNG chunk must be IHDR.',
      };
    }

    if (
      chunkType === 'acTL' ||
      chunkType === 'fcTL' ||
      chunkType === 'fdAT'
    ) {
      return {
        ok: false,
        code: 'ANIMATED_IMAGE_FORBIDDEN',
        reason: `Animated PNG (APNG chunk "${chunkType}") is forbidden by editorial intake policy.`,
      };
    }

    if (chunkType === 'IHDR') {
      if (sawIhdr || chunkLength !== 13) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'Invalid or duplicate PNG IHDR chunk.',
        };
      }
      sawIhdr = true;
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      const bitDepth = buffer[dataStart + 8];
      const colorType = buffer[dataStart + 9];
      const compressionMethod = buffer[dataStart + 10];
      const filterMethod = buffer[dataStart + 11];
      const interlaceMethod = buffer[dataStart + 12];

      if (
        !isValidPngColorAndBitDepth(colorType, bitDepth) ||
        compressionMethod !== 0 ||
        filterMethod !== 0 ||
        (interlaceMethod !== 0 && interlaceMethod !== 1)
      ) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'Invalid PNG IHDR color type, bit depth, or compression/filter flags.',
        };
      }
    } else if (chunkType === 'IDAT') {
      if (!sawIhdr) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'PNG IDAT chunk encountered before IHDR.',
        };
      }
      if (chunkLength > 0) {
        sawIdat = true;
      }
    } else if (chunkType === 'IEND') {
      if (!sawIhdr || !sawIdat || chunkLength !== 0) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'PNG IEND chunk encountered without valid IHDR/IDAT or with non-zero length.',
        };
      }
      sawIend = true;
      offset = crcEnd;
      break;
    }

    offset = crcEnd;
  }

  if (!sawIhdr || !sawIdat || !sawIend) {
    return {
      ok: false,
      code: 'CORRUPTED_HEADER_OR_STRUCTURE',
      reason: 'Incomplete PNG stream missing IHDR, IDAT, or IEND chunk.',
    };
  }

  if (offset < buffer.length) {
    return {
      ok: false,
      code: 'TRAILING_DATA_AFTER_TERMINATOR',
      reason: `Detected ${buffer.length - offset} trailing byte(s) after PNG IEND chunk.`,
    };
  }

  return {
    ok: true,
    width,
    height,
    notes: [
      `PNG container verified (${chunkIndex} chunks, CRC-32 validated, static single-frame).`,
    ],
  };
}

function isJpegSofMarker(marker: number): boolean {
  // SOF0..SOF15 except 0xC4 (DHT), 0xC8 (JPG), 0xCC (DAC)
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function parseJpegStructure(
  buffer: Buffer,
  policy: EditorialImageInspectionPolicy
): ImageStructureParseOutcome {
  if (buffer.length < 20) {
    return {
      ok: false,
      code: 'CORRUPTED_HEADER_OR_STRUCTURE',
      reason: 'JPEG binary is shorter than minimum valid segment structure.',
    };
  }

  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return {
      ok: false,
      code: 'CORRUPTED_HEADER_OR_STRUCTURE',
      reason: 'Missing JPEG SOI marker at offset 0.',
    };
  }

  let offset = 2;
  let segmentCount = 0;
  let sawSof = false;
  let sawSos = false;
  let sawEoi = false;
  let width = 0;
  let height = 0;

  while (offset < buffer.length) {
    segmentCount += 1;
    if (segmentCount > policy.maxJpegSegments) {
      return {
        ok: false,
        code: 'CORRUPTED_HEADER_OR_STRUCTURE',
        reason: `JPEG segment count exceeded maximum limit of ${policy.maxJpegSegments}.`,
      };
    }

    if (buffer[offset] !== 0xff) {
      return {
        ok: false,
        code: 'CORRUPTED_HEADER_OR_STRUCTURE',
        reason: `Expected JPEG marker prefix 0xFF at offset ${offset}.`,
      };
    }

    // Advance past any padding 0xFF bytes (bounded by buffer length)
    let ffRun = 0;
    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset += 1;
      ffRun += 1;
      if (ffRun > 64) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'Excessive 0xFF marker fill run in JPEG stream.',
        };
      }
    }

    if (offset >= buffer.length) {
      return {
        ok: false,
        code: 'CORRUPTED_HEADER_OR_STRUCTURE',
        reason: 'Truncated JPEG marker at end of stream.',
      };
    }

    const marker = buffer[offset];
    offset += 1;

    if (marker === 0x00) {
      return {
        ok: false,
        code: 'CORRUPTED_HEADER_OR_STRUCTURE',
        reason: 'Unexpected byte-stuffed 0xFF00 outside entropy-coded JPEG scan.',
      };
    }

    if (marker === 0xd8) {
      return {
        ok: false,
        code: 'CORRUPTED_HEADER_OR_STRUCTURE',
        reason: 'Unexpected duplicate SOI marker inside JPEG stream.',
      };
    }

    if (marker === 0xd9) {
      // EOI outside entropy scan
      if (!sawSof || !sawSos) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'JPEG EOI marker encountered before SOF and SOS segments.',
        };
      }
      sawEoi = true;
      break;
    }

    // Standalone markers without length: TEM (0x01) and RST0..RST7 (0xD0..0xD7)
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 2 > buffer.length) {
      return {
        ok: false,
        code: 'CORRUPTED_HEADER_OR_STRUCTURE',
        reason: 'Truncated JPEG segment length.',
      };
    }

    const segLength = buffer.readUInt16BE(offset);
    if (segLength < 2 || offset + segLength > buffer.length) {
      return {
        ok: false,
        code: 'CORRUPTED_HEADER_OR_STRUCTURE',
        reason: 'Invalid JPEG segment length.',
      };
    }

    const payloadStart = offset + 2;
    const payloadLength = segLength - 2;

    // Reject Multi-Picture Format (MPF) APP2 container
    if (marker === 0xe2 && payloadLength >= 4) {
      if (
        buffer[payloadStart] === 0x4d && // 'M'
        buffer[payloadStart + 1] === 0x50 && // 'P'
        buffer[payloadStart + 2] === 0x46 && // 'F'
        buffer[payloadStart + 3] === 0x00
      ) {
        return {
          ok: false,
          code: 'MULTI_PICTURE_FORBIDDEN',
          reason: 'Multi-Picture Format (MPF APP2) JPEG is forbidden by editorial intake policy.',
        };
      }
    }

    if (isJpegSofMarker(marker)) {
      if (payloadLength < 6) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'Malformed JPEG SOF segment.',
        };
      }
      const samplePrecision = buffer[payloadStart];
      const sofHeight = buffer.readUInt16BE(payloadStart + 1);
      const sofWidth = buffer.readUInt16BE(payloadStart + 3);
      const numComponents = buffer[payloadStart + 5];

      if (
        (samplePrecision !== 8 &&
          samplePrecision !== 12 &&
          samplePrecision !== 16) ||
        numComponents < 1 ||
        numComponents > 4 ||
        payloadLength !== 6 + numComponents * 3
      ) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'Invalid JPEG SOF component table or sample precision.',
        };
      }

      if (sofWidth === 0 || sofHeight === 0) {
        return {
          ok: false,
          code: 'INVALID_DIMENSIONS',
          reason: 'JPEG SOF dimensions must be strictly positive.',
        };
      }

      if (sawSof && (width !== sofWidth || height !== sofHeight)) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'Conflicting JPEG SOF dimensions across frame headers.',
        };
      }

      sawSof = true;
      width = sofWidth;
      height = sofHeight;
    }

    offset += segLength;

    if (marker === 0xda) {
      // Start of Scan (SOS)
      if (!sawSof) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'JPEG SOS marker encountered before SOF frame header.',
        };
      }
      sawSos = true;

      // Scan entropy-coded bytes until an unescaped non-RST marker is reached
      let entropyBytes = 0;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          entropyBytes += 1;
          continue;
        }

        // Found 0xFF inside entropy stream; inspect following byte(s)
        let nextPos = offset + 1;
        while (nextPos < buffer.length && buffer[nextPos] === 0xff) {
          nextPos += 1;
        }
        if (nextPos >= buffer.length) {
          return {
            ok: false,
            code: 'CORRUPTED_HEADER_OR_STRUCTURE',
            reason: 'Truncated 0xFF sequence at end of JPEG entropy scan.',
          };
        }

        const nextMarker = buffer[nextPos];
        if (nextMarker === 0x00) {
          // Byte-stuffed 0xFF00 inside entropy data
          offset = nextPos + 1;
          entropyBytes += 1;
          continue;
        }

        if (nextMarker >= 0xd0 && nextMarker <= 0xd7) {
          // Restart marker inside entropy data
          offset = nextPos + 1;
          continue;
        }

        if (entropyBytes === 0) {
          return {
            ok: false,
            code: 'CORRUPTED_HEADER_OR_STRUCTURE',
            reason: 'Empty JPEG SOS entropy scan.',
          };
        }

        // Reached the next structural JPEG marker (e.g. EOI 0xD9 or another SOS in progressive JPEG)
        break;
      }
    }
  }

  if (!sawSof || !sawSos || !sawEoi) {
    return {
      ok: false,
      code: 'CORRUPTED_HEADER_OR_STRUCTURE',
      reason: 'Incomplete JPEG stream missing SOF, SOS, or EOI marker.',
    };
  }

  if (offset < buffer.length) {
    return {
      ok: false,
      code: 'TRAILING_DATA_AFTER_TERMINATOR',
      reason: `Detected ${buffer.length - offset} trailing byte(s) after JPEG EOI marker.`,
    };
  }

  return {
    ok: true,
    width,
    height,
    notes: [
      `JPEG segment structure verified (${segmentCount} segments, SOF/SOS/EOI validated, no MPF/trailing data).`,
    ],
  };
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return (
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16)
  ) >>> 0;
}

function parseWebpStructure(
  buffer: Buffer,
  policy: EditorialImageInspectionPolicy
): ImageStructureParseOutcome {
  if (buffer.length < 20) {
    return {
      ok: false,
      code: 'CORRUPTED_HEADER_OR_STRUCTURE',
      reason: 'WebP binary is shorter than minimum valid RIFF/WEBP container.',
    };
  }

  const riffPayloadSize = buffer.readUInt32LE(4);
  const expectedTotalSize = 8 + riffPayloadSize;

  if (riffPayloadSize < 12 || expectedTotalSize > buffer.length) {
    return {
      ok: false,
      code: 'CORRUPTED_HEADER_OR_STRUCTURE',
      reason: 'WebP RIFF payload size exceeds actual buffer length or is truncated.',
    };
  }

  if (buffer.length > expectedTotalSize) {
    return {
      ok: false,
      code: 'TRAILING_DATA_AFTER_TERMINATOR',
      reason: `Detected ${buffer.length - expectedTotalSize} trailing byte(s) beyond WebP RIFF container size.`,
    };
  }

  let offset = 12;
  let chunkCount = 0;
  let vp8xDims: { width: number; height: number } | null = null;
  let bitstreamDims: { width: number; height: number } | null = null;

  while (offset < expectedTotalSize) {
    chunkCount += 1;
    if (chunkCount > policy.maxWebpChunks) {
      return {
        ok: false,
        code: 'CORRUPTED_HEADER_OR_STRUCTURE',
        reason: `WebP RIFF chunk count exceeded maximum limit of ${policy.maxWebpChunks}.`,
      };
    }

    if (offset + 8 > expectedTotalSize) {
      return {
        ok: false,
        code: 'CORRUPTED_HEADER_OR_STRUCTURE',
        reason: 'Truncated WebP RIFF subchunk header.',
      };
    }

    const fourCC = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    const paddedEnd = dataEnd + (chunkSize & 1);

    if (dataEnd > expectedTotalSize || paddedEnd > expectedTotalSize) {
      return {
        ok: false,
        code: 'CORRUPTED_HEADER_OR_STRUCTURE',
        reason: `WebP chunk "${fourCC}" size exceeds RIFF container boundary.`,
      };
    }

    if (fourCC === 'ANIM' || fourCC === 'ANMF') {
      return {
        ok: false,
        code: 'ANIMATED_IMAGE_FORBIDDEN',
        reason: `Animated WebP (chunk "${fourCC}") is forbidden by editorial intake policy.`,
      };
    }

    if (fourCC === 'VP8X') {
      if (chunkCount !== 1 || chunkSize !== 10 || vp8xDims !== null) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'Malformed or misplaced WebP VP8X extended header chunk.',
        };
      }
      const flags = buffer[dataStart];
      // Reserved bits check: top 2 bits (0xC0) and bit 0 (0x01) must be 0 in valid VP8X
      if ((flags & 0xc1) !== 0) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'WebP VP8X header contains non-zero reserved flag bits.',
        };
      }
      if ((flags & 0x02) !== 0) {
        return {
          ok: false,
          code: 'ANIMATED_IMAGE_FORBIDDEN',
          reason: 'Animated WebP (VP8X animation flag set) is forbidden by editorial intake policy.',
        };
      }
      const w = 1 + readUInt24LE(buffer, dataStart + 4);
      const h = 1 + readUInt24LE(buffer, dataStart + 7);
      vp8xDims = { width: w, height: h };
    } else if (fourCC === 'VP8 ') {
      if (bitstreamDims !== null || chunkSize < 10) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'Duplicate or truncated WebP VP8 lossy bitstream chunk.',
        };
      }
      const frameTag = readUInt24LE(buffer, dataStart);
      const isKeyFrame = (frameTag & 0x01) === 0;
      if (
        !isKeyFrame ||
        buffer[dataStart + 3] !== 0x9d ||
        buffer[dataStart + 4] !== 0x01 ||
        buffer[dataStart + 5] !== 0x2a
      ) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'Invalid WebP VP8 keyframe start code signature.',
        };
      }
      const w = buffer.readUInt16LE(dataStart + 6) & 0x3fff;
      const h = buffer.readUInt16LE(dataStart + 8) & 0x3fff;
      bitstreamDims = { width: w, height: h };
    } else if (fourCC === 'VP8L') {
      if (bitstreamDims !== null || chunkSize < 5) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'Duplicate or truncated WebP VP8L lossless bitstream chunk.',
        };
      }
      if (buffer[dataStart] !== 0x2f) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'Invalid WebP VP8L signature byte (expected 0x2F).',
        };
      }
      const bits = buffer.readUInt32LE(dataStart + 1);
      const version = (bits >>> 29) & 0x07;
      if (version !== 0) {
        return {
          ok: false,
          code: 'CORRUPTED_HEADER_OR_STRUCTURE',
          reason: 'Unsupported WebP VP8L bitstream version.',
        };
      }
      const w = (bits & 0x3fff) + 1;
      const h = ((bits >>> 14) & 0x3fff) + 1;
      bitstreamDims = { width: w, height: h };
    }

    offset = paddedEnd;
  }

  if (!bitstreamDims) {
    return {
      ok: false,
      code: 'CORRUPTED_HEADER_OR_STRUCTURE',
      reason: 'WebP container does not contain a valid VP8 or VP8L image bitstream chunk.',
    };
  }

  if (
    vp8xDims &&
    (vp8xDims.width !== bitstreamDims.width ||
      vp8xDims.height !== bitstreamDims.height)
  ) {
    return {
      ok: false,
      code: 'CORRUPTED_HEADER_OR_STRUCTURE',
      reason: 'WebP VP8X canvas dimensions do not match bitstream dimensions.',
    };
  }

  return {
    ok: true,
    width: bitstreamDims.width,
    height: bitstreamDims.height,
    notes: [
      `WebP RIFF container verified (${chunkCount} chunks, static single-frame bitstream).`,
    ],
  };
}

/**
 * Decodes PDF Name hex escapes (e.g. `/#4a#61#76#61#53#63#72#69#70#74` -> `/JavaScript`)
 * so active PDF constructs cannot evade heuristic token screening via `#XX` escapes.
 */
function normalizePdfNameHexEscapes(latin1Text: string): string {
  return latin1Text.replace(/#([0-9a-fA-F]{2})/g, (_match, hex: string) => {
    const code = Number.parseInt(hex, 16);
    return String.fromCharCode(code);
  });
}

const FORBIDDEN_PDF_CONSTRUCT_PATTERNS: readonly {
  readonly regex: RegExp;
  readonly label: string;
}[] = [
  { regex: /\/JavaScript(?![A-Za-z0-9_])/i, label: '/JavaScript' },
  { regex: /\/JS(?![A-Za-z0-9_])/i, label: '/JS' },
  { regex: /\/Launch(?![A-Za-z0-9_])/i, label: '/Launch' },
  { regex: /\/EmbeddedFiles(?![A-Za-z0-9_])/i, label: '/EmbeddedFiles' },
  { regex: /\/EmbeddedFile(?![A-Za-z0-9_])/i, label: '/EmbeddedFile' },
  { regex: /\/RichMedia(?![A-Za-z0-9_])/i, label: '/RichMedia' },
  { regex: /\/SubmitForm(?![A-Za-z0-9_])/i, label: '/SubmitForm' },
  { regex: /\/ImportData(?![A-Za-z0-9_])/i, label: '/ImportData' },
  { regex: /\/GoToR(?![A-Za-z0-9_])/i, label: '/GoToR' },
  { regex: /\/GoToE(?![A-Za-z0-9_])/i, label: '/GoToE' },
  { regex: /\/OpenAction(?![A-Za-z0-9_])/i, label: '/OpenAction' },
  { regex: /\/AA(?![A-Za-z0-9_])/i, label: '/AA' },
  { regex: /\/XFA(?![A-Za-z0-9_])/i, label: '/XFA' },
  { regex: /\/URI(?![A-Za-z0-9_])/i, label: '/URI' },
];

interface PdfScreeningOutcome {
  readonly ok: boolean;
  readonly code?: EditorialBinaryRejectionCode;
  readonly reason?: string;
  readonly notes?: readonly string[];
}

function inspectPdfEvidenceBuffer(buffer: Buffer): PdfScreeningOutcome {
  if (buffer.length < 32) {
    return {
      ok: false,
      code: 'CORRUPTED_HEADER_OR_STRUCTURE',
      reason: 'PDF binary is shorter than minimum valid PDF header/trailer structure.',
    };
  }

  const headerAscii = buffer.toString('ascii', 0, Math.min(16, buffer.length));
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(headerAscii)) {
    return {
      ok: false,
      code: 'CORRUPTED_HEADER_OR_STRUCTURE',
      reason: 'PDF header must begin at offset 0 with a valid %PDF-1.x or %PDF-2.0 version line.',
    };
  }

  // Polyglot check inside PDF (HTML/script/ZIP headers)
  const lowerBuf = Buffer.allocUnsafe(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    const b = buffer[i];
    lowerBuf[i] = b >= 0x41 && b <= 0x5a ? b + 0x20 : b;
  }
  if (
    lowerBuf.indexOf(Buffer.from('<script', 'ascii')) !== -1 ||
    lowerBuf.indexOf(Buffer.from('<html', 'ascii')) !== -1 ||
    lowerBuf.indexOf(Buffer.from('<!doctype html', 'ascii')) !== -1 ||
    buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04])) !== -1
  ) {
    return {
      ok: false,
      code: 'POLYGLOT_SIGNATURE_DETECTED',
      reason: 'Detected polyglot HTML/script or ZIP signature embedded in PDF evidence binary.',
    };
  }

  const latin1Content = buffer.toString('latin1');
  const normalizedContent = normalizePdfNameHexEscapes(latin1Content);

  const hasXref =
    /\bxref\b/.test(normalizedContent) ||
    /\/Type\s*\/XRef(?![A-Za-z0-9_])/.test(normalizedContent);
  const hasStartXref = /\bstartxref\b/.test(normalizedContent);

  if (!hasXref || !hasStartXref) {
    return {
      ok: false,
      code: 'PDF_MISSING_EOF_OR_XREF',
      reason: 'PDF binary is missing required xref table/stream or startxref marker.',
    };
  }

  const lastEofIndex = latin1Content.lastIndexOf('%%EOF');
  if (lastEofIndex === -1) {
    return {
      ok: false,
      code: 'PDF_MISSING_EOF_OR_XREF',
      reason: 'PDF binary is missing required %%EOF trailer.',
    };
  }

  const trailingAfterEof = latin1Content.slice(lastEofIndex + 5);
  if (
    trailingAfterEof.length > 8 ||
    !/^[\r\n \t]*$/.test(trailingAfterEof)
  ) {
    return {
      ok: false,
      code: 'TRAILING_DATA_AFTER_TERMINATOR',
      reason: 'Detected non-whitespace or excessive trailing data after PDF %%EOF marker.',
    };
  }

  for (const { regex, label } of FORBIDDEN_PDF_CONSTRUCT_PATTERNS) {
    if (regex.test(normalizedContent)) {
      return {
        ok: false,
        code: 'PDF_ACTIVE_CONTENT_DETECTED',
        reason: `Heuristic PDF screening rejected active or external construct (${label}).`,
      };
    }
  }

  return {
    ok: true,
    notes: [
      'Preliminary PDF header/xref/%%EOF structure verified.',
      'Heuristic PDF active-content screening passed (not a substitute for isolated PDF sanitization/rendering).',
    ],
  };
}

/**
 * Performs preliminary binary inspection on an editorial image binary (`image/png`, `image/jpeg`, `image/webp`).
 */
export function inspectEditorialImageBinary(
  rawBuffer: Buffer | Uint8Array,
  options?: InspectEditorialImageBinaryOptions
): EditorialImageBinaryInspectionResult {
  const buffer = toNodeBuffer(rawBuffer);
  if (!buffer) {
    return {
      status: 'REJECTED',
      targetKind: 'editorial_image_asset',
      rejectionCode: 'INVALID_BUFFER',
      rejectionReason: 'Input must be a valid Node.js Buffer or Uint8Array.',
      detectedMimeType: null,
      sizeBytes: 0,
      sha256Checksum: null,
    };
  }

  const policy = resolvePolicy(DEFAULT_IMAGE_INSPECTION_POLICY, options?.policy);
  const sizeBytes = buffer.length;

  if (sizeBytes <= 0) {
    return {
      status: 'REJECTED',
      targetKind: 'editorial_image_asset',
      rejectionCode: 'EMPTY_BINARY',
      rejectionReason: 'Editorial image binary cannot be empty.',
      detectedMimeType: null,
      sizeBytes: 0,
      sha256Checksum: null,
    };
  }

  if (sizeBytes > policy.maxSizeBytes) {
    return {
      status: 'REJECTED',
      targetKind: 'editorial_image_asset',
      rejectionCode: 'SIZE_LIMIT_EXCEEDED',
      rejectionReason: `Editorial image binary size (${sizeBytes} bytes) exceeds maximum limit (${policy.maxSizeBytes} bytes).`,
      detectedMimeType: null,
      sizeBytes,
      sha256Checksum: null,
    };
  }

  const sha256Checksum = computeSha256Hex(buffer);
  const magic = detectMagicMimeType(buffer, false);

  if (!magic || magic.mimeType === 'application/pdf') {
    return {
      status: 'REJECTED',
      targetKind: 'editorial_image_asset',
      rejectionCode: 'UNSUPPORTED_MAGIC_BYTES',
      rejectionReason:
        'Unsupported or unrecognized image magic bytes. Allowed formats: image/png, image/jpeg, image/webp.',
      detectedMimeType: null,
      sizeBytes,
      sha256Checksum,
    };
  }

  const detectedMimeType = magic.mimeType as EditorialImageAssetVariantFormat;
  const canonicalExtension = magic.canonicalExtension as 'png' | 'jpg' | 'webp';

  if (options?.claimedMimeType !== undefined) {
    const normalizedClaimedMime = options.claimedMimeType.trim().toLowerCase();
    if (normalizedClaimedMime !== detectedMimeType) {
      return {
        status: 'REJECTED',
        targetKind: 'editorial_image_asset',
        rejectionCode: 'CLAIMED_MIME_MISMATCH',
        rejectionReason: `Claimed MIME type "${options.claimedMimeType}" does not match magic-byte detected MIME type "${detectedMimeType}".`,
        detectedMimeType,
        sizeBytes,
        sha256Checksum,
      };
    }
  }

  if (options?.claimedFilenameOrExtension !== undefined) {
    if (
      !matchesClaimedExtension(
        detectedMimeType,
        options.claimedFilenameOrExtension
      )
    ) {
      return {
        status: 'REJECTED',
        targetKind: 'editorial_image_asset',
        rejectionCode: 'CLAIMED_EXTENSION_MISMATCH',
        rejectionReason: `Claimed filename/extension "${options.claimedFilenameOrExtension}" does not match detected MIME type "${detectedMimeType}".`,
        detectedMimeType,
        sizeBytes,
        sha256Checksum,
      };
    }
  }

  const polyglotReason = detectImagePolyglotIndicators(buffer);
  if (polyglotReason) {
    return {
      status: 'REJECTED',
      targetKind: 'editorial_image_asset',
      rejectionCode: 'POLYGLOT_SIGNATURE_DETECTED',
      rejectionReason: polyglotReason,
      detectedMimeType,
      sizeBytes,
      sha256Checksum,
    };
  }

  let parseOutcome: ImageStructureParseOutcome;
  if (detectedMimeType === 'image/png') {
    parseOutcome = parsePngStructure(buffer, policy);
  } else if (detectedMimeType === 'image/jpeg') {
    parseOutcome = parseJpegStructure(buffer, policy);
  } else {
    parseOutcome = parseWebpStructure(buffer, policy);
  }

  if (!parseOutcome.ok) {
    return {
      status: 'REJECTED',
      targetKind: 'editorial_image_asset',
      rejectionCode: parseOutcome.code,
      rejectionReason: parseOutcome.reason,
      detectedMimeType,
      sizeBytes,
      sha256Checksum,
    };
  }

  const { width, height, notes } = parseOutcome;

  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < policy.minDimensionPx ||
    height < policy.minDimensionPx
  ) {
    return {
      status: 'REJECTED',
      targetKind: 'editorial_image_asset',
      rejectionCode: 'INVALID_DIMENSIONS',
      rejectionReason: `Invalid image dimensions (${width}x${height}). Minimum is ${policy.minDimensionPx}px per axis.`,
      detectedMimeType,
      sizeBytes,
      sha256Checksum,
    };
  }

  if (width > policy.maxDimensionPx || height > policy.maxDimensionPx) {
    return {
      status: 'REJECTED',
      targetKind: 'editorial_image_asset',
      rejectionCode: 'AXIS_DIMENSION_EXCEEDED',
      rejectionReason: `Image dimensions (${width}x${height}) exceed maximum axis limit of ${policy.maxDimensionPx}px.`,
      detectedMimeType,
      sizeBytes,
      sha256Checksum,
    };
  }

  const totalPixels = width * height;
  if (totalPixels > policy.maxTotalPixels) {
    return {
      status: 'REJECTED',
      targetKind: 'editorial_image_asset',
      rejectionCode: 'TOTAL_PIXEL_BUDGET_EXCEEDED',
      rejectionReason: `Image total pixel count (${totalPixels} pixels) exceeds preliminary intake pixel budget (${policy.maxTotalPixels} pixels).`,
      detectedMimeType,
      sizeBytes,
      sha256Checksum,
    };
  }

  const aspectRatio = Number((width / height).toFixed(4));

  return {
    status: 'PRELIMINARY_VERIFIED',
    targetKind: 'editorial_image_asset',
    detectedMimeType,
    canonicalExtension,
    sizeBytes,
    sha256Checksum,
    width,
    height,
    totalPixels,
    aspectRatio,
    animated: false,
    fullPixelDecodePerformed: false,
    reencodedOrStripped: false,
    inspectionNotes: [
      ...notes,
      'Preliminary structural verification only; full pixel decode and metadata stripping require native media worker.',
    ],
  };
}

/**
 * Performs preliminary binary inspection on a confidential rights-evidence binary
 * (`application/pdf`, `image/png`, `image/jpeg`, `image/webp`).
 */
export function inspectRightsEvidenceBinary(
  rawBuffer: Buffer | Uint8Array,
  options?: InspectRightsEvidenceBinaryOptions
): RightsEvidenceBinaryInspectionResult {
  const buffer = toNodeBuffer(rawBuffer);
  if (!buffer) {
    return {
      status: 'REJECTED',
      targetKind: 'rights_evidence_binary',
      rejectionCode: 'INVALID_BUFFER',
      rejectionReason: 'Input must be a valid Node.js Buffer or Uint8Array.',
      detectedMimeType: null,
      sizeBytes: 0,
      sha256Checksum: null,
    };
  }

  const policy = resolvePolicy(
    DEFAULT_EVIDENCE_INSPECTION_POLICY,
    options?.policy
  );
  const sizeBytes = buffer.length;

  if (sizeBytes <= 0) {
    return {
      status: 'REJECTED',
      targetKind: 'rights_evidence_binary',
      rejectionCode: 'EMPTY_BINARY',
      rejectionReason: 'Rights evidence binary cannot be empty.',
      detectedMimeType: null,
      sizeBytes: 0,
      sha256Checksum: null,
    };
  }

  if (sizeBytes > policy.maxSizeBytes) {
    return {
      status: 'REJECTED',
      targetKind: 'rights_evidence_binary',
      rejectionCode: 'SIZE_LIMIT_EXCEEDED',
      rejectionReason: `Rights evidence binary size (${sizeBytes} bytes) exceeds maximum limit (${policy.maxSizeBytes} bytes).`,
      detectedMimeType: null,
      sizeBytes,
      sha256Checksum: null,
    };
  }

  const sha256Checksum = computeSha256Hex(buffer);
  const magic = detectMagicMimeType(buffer, true);

  if (!magic) {
    return {
      status: 'REJECTED',
      targetKind: 'rights_evidence_binary',
      rejectionCode: 'UNSUPPORTED_MAGIC_BYTES',
      rejectionReason:
        'Unsupported rights evidence binary signature. Allowed formats: application/pdf, image/png, image/jpeg, image/webp.',
      detectedMimeType: null,
      sizeBytes,
      sha256Checksum,
    };
  }

  const detectedMimeType = magic.mimeType;
  const canonicalExtension = magic.canonicalExtension;

  if (options?.claimedMimeType !== undefined) {
    const normalizedClaimedMime = options.claimedMimeType.trim().toLowerCase();
    if (normalizedClaimedMime !== detectedMimeType) {
      return {
        status: 'REJECTED',
        targetKind: 'rights_evidence_binary',
        rejectionCode: 'CLAIMED_MIME_MISMATCH',
        rejectionReason: `Claimed MIME type "${options.claimedMimeType}" does not match magic-byte detected MIME type "${detectedMimeType}".`,
        detectedMimeType,
        sizeBytes,
        sha256Checksum,
      };
    }
  }

  if (options?.claimedFilenameOrExtension !== undefined) {
    if (
      !matchesClaimedExtension(
        detectedMimeType,
        options.claimedFilenameOrExtension
      )
    ) {
      return {
        status: 'REJECTED',
        targetKind: 'rights_evidence_binary',
        rejectionCode: 'CLAIMED_EXTENSION_MISMATCH',
        rejectionReason: `Claimed filename/extension "${options.claimedFilenameOrExtension}" does not match detected MIME type "${detectedMimeType}".`,
        detectedMimeType,
        sizeBytes,
        sha256Checksum,
      };
    }
  }

  if (detectedMimeType === 'application/pdf') {
    const pdfOutcome = inspectPdfEvidenceBuffer(buffer);
    if (!pdfOutcome.ok) {
      return {
        status: 'REJECTED',
        targetKind: 'rights_evidence_binary',
        rejectionCode: pdfOutcome.code ?? 'CORRUPTED_HEADER_OR_STRUCTURE',
        rejectionReason:
          pdfOutcome.reason ?? 'PDF evidence failed preliminary inspection.',
        detectedMimeType,
        sizeBytes,
        sha256Checksum,
      };
    }

    return {
      status: 'PRELIMINARY_VERIFIED',
      targetKind: 'rights_evidence_binary',
      detectedMimeType: 'application/pdf',
      canonicalExtension: 'pdf',
      sizeBytes,
      sha256Checksum,
      heuristicPdfScreening: true,
      fullPixelDecodePerformed: false,
      sanitized: false,
      inspectionNotes: pdfOutcome.notes ?? [],
    };
  }

  // Image-based rights evidence reuses the strict image structural parser
  const imageResult = inspectEditorialImageBinary(buffer, {
    claimedMimeType: options?.claimedMimeType,
    claimedFilenameOrExtension: options?.claimedFilenameOrExtension,
    policy,
  });

  if (imageResult.status === 'REJECTED') {
    return {
      ...imageResult,
      targetKind: 'rights_evidence_binary',
    };
  }

  return {
    status: 'PRELIMINARY_VERIFIED',
    targetKind: 'rights_evidence_binary',
    detectedMimeType: imageResult.detectedMimeType,
    canonicalExtension: imageResult.canonicalExtension,
    sizeBytes: imageResult.sizeBytes,
    sha256Checksum: imageResult.sha256Checksum,
    width: imageResult.width,
    height: imageResult.height,
    totalPixels: imageResult.totalPixels,
    aspectRatio: imageResult.aspectRatio,
    heuristicPdfScreening: false,
    fullPixelDecodePerformed: false,
    sanitized: false,
    inspectionNotes: imageResult.inspectionNotes,
  };
}
