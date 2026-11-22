import { useQuery } from "@tanstack/react-query";
import { useApiClient, UnauthorizedError } from "../api-client.js";
import { useNavigate } from "@tanstack/react-router";
import { reconcilePageSlots } from "./reconcile-page-slots.js";

/**
 * Resolves the current page per slot for a book, across however many
 * regeneration/photo-replacement runs it has accumulated beyond its
 * primary run. Shared by the review and preview screens.
 */
export function useBookPages(bookId, primaryRunId) {
  const api = useApiClient();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ["book-pages", bookId, primaryRunId],
    queryFn: async () => {
      try {
        const [primaryRun, { runs }] = await Promise.all([
          api.getBookRun(bookId, primaryRunId),
          api.listBookRuns(bookId),
        ]);
        const otherRunIds = runs
          .map(run => run.runId)
          .filter(runId => runId !== primaryRunId);
        const otherRuns = await Promise.all(
          otherRunIds.map(runId => api.getBookRun(bookId, runId))
        );
        return reconcilePageSlots({ primaryRun, otherRuns });
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          navigate({ to: "/sign-in" });
          return null;
        }
        throw err;
      }
    },
    enabled: Boolean(bookId && primaryRunId),
    refetchInterval: query => {
      const data = query.state.data;
      if (!data) return false;
      // Keep polling while any slot is mid-generation (same statuses
      // use-book-run.js treats as active for a single run).
      const ACTIVE_PAGE_STATES = new Set([
        "created",
        "analyzing",
        "generating",
        "print_qa",
        "style_qa",
        "repairing",
      ]);
      return data.slots.some(slot =>
        ACTIVE_PAGE_STATES.has(slot.currentPage.state)
      )
        ? 2000
        : false;
    },
  });

  return {
    slots: query.data?.slots ?? [],
    regenerationsUsed: query.data?.regenerationsUsed ?? 0,
    replacementsUsed: query.data?.replacementsUsed ?? 0,
    isLoading: query.isLoading,
  };
}
