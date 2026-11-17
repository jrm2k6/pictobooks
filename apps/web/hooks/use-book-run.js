import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useApiClient, UnauthorizedError } from "../api-client.js";

/** Run statuses that indicate active processing — keep polling. */
const ACTIVE_STATUSES = new Set(["created", "running", "partially_completed"]);

/**
 * Query hook: get a book run's detail, with auto-polling while processing.
 * Polling stops when status reaches a terminal state.
 * Redirects to /sign-in on 401.
 *
 * @param {string|null|undefined} bookId
 * @param {string|null|undefined} runId
 */
export function useBookRun(bookId, runId) {
  const api = useApiClient();
  const navigate = useNavigate();

  return useQuery({
    queryKey: ["book-run", bookId, runId],
    queryFn: async () => {
      try {
        return await api.getBookRun(bookId, runId);
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          navigate({ to: "/sign-in" });
          return null;
        }
        throw err;
      }
    },
    enabled: Boolean(bookId && runId),
    refetchInterval: query => {
      const data = query.state.data;
      if (!data) return false;
      return ACTIVE_STATUSES.has(data.status) ? 2000 : false;
    },
  });
}
