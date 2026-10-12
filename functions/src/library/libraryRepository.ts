import type { LibraryDocument } from '../../../src/types/library';

export interface LibraryRepository {
  getById(id: string): Promise<LibraryDocument | null>;
  create(doc: LibraryDocument): Promise<LibraryDocument>;
  update(doc: LibraryDocument): Promise<LibraryDocument>;
  listAll(): Promise<LibraryDocument[]>;
}
