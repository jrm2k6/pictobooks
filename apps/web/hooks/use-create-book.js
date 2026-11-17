import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "../api-client.js";

/**
 * Mutation hook: create a new draft book.
 * Invalidates the books list on success.
 *
 * @example
 * const { mutateAsync } = useCreateBook();
 * const { bookId } = await mutateAsync({ title, childName, childAge });
 */
export function useCreateBook() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: data => api.createBook(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["books"] });
    },
  });
}
