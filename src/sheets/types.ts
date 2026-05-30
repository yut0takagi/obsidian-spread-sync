export interface RangeSpec {
  sheet: string;
  range?: string;   // A1 notation
  named?: string;
}

export interface ReadResult {
  range: string;             // canonical range echoed by API
  values: unknown[][];       // always 2D; single cell becomes [[v]]
}

export interface WriteResult {
  updatedRange: string;
  updatedCells: number;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
