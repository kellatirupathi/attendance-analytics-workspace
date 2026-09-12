import { useMutation } from "@tanstack/react-query";
import type {
  MutationFunction,
  UseMutationOptions,
  UseMutationResult,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { BodyType, ErrorType } from "./custom-fetch";
import type { User } from "./generated/api.schemas";

export interface BulkUserRow {
  name: string;
  email: string;
  role: string;
  password?: string;
  campuses?: string[];
  subjects?: string[];
}

export interface BulkUserInput {
  password?: string;
  users: BulkUserRow[];
}

export interface BulkUserIssue {
  row: number;
  email: string;
  reason: string;
}

export interface BulkUserResult {
  created: User[];
  skipped: BulkUserIssue[];
  errors: BulkUserIssue[];
}

export const getBulkCreateUsersUrl = () => "/api/admin/users/bulk";

export const bulkCreateUsers = async (
  bulkUserInput: BulkUserInput,
  options?: RequestInit,
): Promise<BulkUserResult> => {
  return customFetch<BulkUserResult>(getBulkCreateUsersUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(bulkUserInput),
  });
};

export const useBulkCreateUsers = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof bulkCreateUsers>>,
    TError,
    { data: BodyType<BulkUserInput> },
    TContext
  >;
  request?: RequestInit;
}): UseMutationResult<
  Awaited<ReturnType<typeof bulkCreateUsers>>,
  TError,
  { data: BodyType<BulkUserInput> },
  TContext
> => {
  const mutationKey = ["bulkCreateUsers"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof bulkCreateUsers>>,
    { data: BodyType<BulkUserInput> }
  > = (props) => {
    const { data } = props ?? {};
    return bulkCreateUsers(data, requestOptions);
  };

  return useMutation({ mutationFn, ...mutationOptions });
};
