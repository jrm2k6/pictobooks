import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useApiClient, UnauthorizedError } from "../api-client.js";

/**
 * getArtifactAccess returns a signed URL that still requires the Bearer
 * token to fetch — this hook does that authenticated fetch once and hands
 * back a local blob: URL an <img> can use directly. staleTime: Infinity
 * because artifact content never changes once uploaded, so there's no
 * reason to refetch or recreate the blob URL for the same id. Blob URLs
 * aren't explicitly revoked (that would need an unmount effect this hook
 * deliberately doesn't have) — the browser reclaims them on navigation,
 * and a single review screen only ever holds a handful at once.
 * Redirects to /sign-in on 401, same as the other data-fetching hooks.
 */
export function useArtifactAccess(artifactId) {
  const api = useApiClient();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ["artifact-access", artifactId],
    queryFn: async () => {
      try {
        const { access } = await api.getArtifactAccess(artifactId);
        const blob = await api.fetchArtifactBlob(access);
        return URL.createObjectURL(blob);
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
  });

  return { url: query.data ?? null, isLoading: query.isLoading };
}
