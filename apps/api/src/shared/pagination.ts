export interface PaginationInput {
  page?: number;
  pageSize?: number;
}

export interface PaginationOptions {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function getPagination(input: PaginationInput): PaginationOptions {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize
  };
}

export function getTotalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
