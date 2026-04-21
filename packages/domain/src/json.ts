export type DomainJsonPrimitive = string | number | boolean | null;
export type DomainJsonValue =
  | DomainJsonPrimitive
  | DomainJsonValue[]
  | { readonly [key: string]: DomainJsonValue };
