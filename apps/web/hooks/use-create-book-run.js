import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "../api-client.js";

/**
 * Mutation hook: create a book run and get upload intents for each photo.
 * After mutation, the caller must PUT each file to its returned uploadUrl.
 *
 * @example
 * const { mutateAsync } = useCreateBookRun();
 * const { bookId, runId, uploads } = await mutateAsync({
 *   bookId,
 *   photos: [{ contentType, byteSize, sha256, ordinal }],
 * });
 * // Then for each upload in uploads: api.uploadPhoto(upload.uploadUrl, upload.requiredHeaders, file)
 */
export function useCreateBookRun() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ bookId, photos }) => api.createBookRun(bookId, { photos }),
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: ["books"] });
      queryClient.invalidateQueries({ queryKey: ["book-runs", data.bookId] });
    },
  });
}
