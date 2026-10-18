import type { LibraryDocument } from '../shared/libraryContract';

export interface LibraryRepository {
  getById(id: string): Promise<LibraryDocument | null>;
  create(doc: LibraryDocument): Promise<LibraryDocument>;
  update(doc: LibraryDocument): Promise<LibraryDocument>;
  listAll(): Promise<LibraryDocument[]>;
}
