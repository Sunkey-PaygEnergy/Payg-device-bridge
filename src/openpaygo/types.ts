export enum OpenPAYGOTokenType {
  ADD_TIME = 1,
  SET_TIME = 2,
  DISABLE_PAYG = 3, // Permanent unlock / Owned
  COUNTER_SYNC = 4,
}

export interface GenerateTokenOptions {
  secretKeyHex: string;
  count: number;
  value: number; // e.g. days or hours to add
  tokenType: OpenPAYGOTokenType;
}

export interface DecodedToken {
  tokenType: OpenPAYGOTokenType;
  value: number;
  count: number;
  isValid: boolean;
}
