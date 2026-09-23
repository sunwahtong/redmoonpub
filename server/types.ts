import type {IncomingMessage, ServerResponse} from 'node:http';

/** A database row. Columns are typed at the call site when it matters. */
export type Row = Record<string, any>;

export interface QueryResult<T = Row> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Row>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  kind: 'postgres' | 'pglite';
  /** Runs a multi-statement script. */
  exec(sql: string): Promise<void>;
  /** Runs `fn` inside a transaction. */
  tx<T>(fn: (client: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type Role = 'staff' | 'manager' | 'owner';

export interface Account {
  id: string;
  username: string;
  name: string;
  nickname: string;
  title: string;
  role: Role;
  jobs: string[];
  phone: string;
  idNumber: string;
  avatar: string;
  /** The store's id of the profile picture, so a replaced one can be removed. */
  avatarPublicId: string;
  /** Where the stored signature lives; empty until one exists. */
  signatureUrl: string;
  signaturePublicId: string;
  signatureAt: string | null;
  /** generated | drawn | uploaded */
  signatureKind: string;
  /** Set once a document carried the signature; it can no longer change. */
  signatureLockedAt: string | null;
  /** The person has chosen (or explicitly kept) their signature. */
  signatureDecided: boolean;
  mustChangePassword: boolean;
  showPublic: boolean;
  active: boolean;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  createdAt: string | null;
}

export interface SessionUser extends Account {
  sessionId: string;
  tokenHash: string;
}

export interface Capabilities {
  manager: boolean;
  owner: boolean;
  dj: boolean;
  runOrders: boolean;
  manageBlips: boolean;
  manageEvents: boolean;
  manageProducts: boolean;
  manageUsers: boolean;
  manageHouse: boolean;
  viewAudit: boolean;
  documents: boolean;
}

export type Request = IncomingMessage & {rmParsedBody?: unknown};

export interface Ctx {
  req: Request;
  res: ServerResponse;
  db: Db;
  user: SessionUser | null;
  params: Record<string, string>;
  query: URLSearchParams;
}

/** The subset of a context a guard needs. */
export type UserCtx = Pick<Ctx, 'user'>;

export type Handler = (ctx: Ctx) => Promise<unknown>;
