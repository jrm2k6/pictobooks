import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useApiClient, UnauthorizedError } from "../api-client.js";

const artifactCaches = new WeakSet();
const INACTIVE_ARTIFACT_GC_MS = 5_000;

function releaseRemovedArtifacts(cache) {
  if (artifactCaches.has(cache)) return;
  artifactCaches.add(cache);
  cache.subscribe(event => {
    if (
      event.type !== "removed" ||
      event.query.queryKey[0] !== "artifact-access"
    )
      return;
    const url = event.query.state.data;
    if (typeof url === "string" && url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  });
}

/** Active observers share one object URL, released after the query is removed. */
export function useArtifactAccess(artifactId) {
  const api = useApiClient();
  const navigate = useNavigate();
  const cache = useQueryClient().getQueryCache();

  const query = useQuery({
    queryKey: ["artifact-access", artifactId],
    queryFn: async ({ signal }) => {
      releaseRemovedArtifacts(cache);
      try {
        const { access } = await api.getArtifactAccess(artifactId);
        const blob = await api.fetchArtifactBlob(access);
        signal.throwIfAborted();
        const url = URL.createObjectURL(blob);
        // Query removal may happen between creation and the cache storing the URL.
        signal.addEventListener("abort", () => URL.revokeObjectURL(url), {
          once: true,
        });
        return url;
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          navigate({ to: "/sign-in" });
          return null;
        }
        throw err;
      }
    },
    enabled: Boolean(artifactId),
    staleTime: Infinity,
    gcTime: INACTIVE_ARTIFACT_GC_MS,
  });

  return { url: query.data ?? null, isLoading: query.isLoading };
}
