import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "../api-client.js";

/**
 * getArtifactAccess returns a signed URL that still requires the Bearer
 * token to fetch — this hook does that authenticated fetch once and hands
 * back a local blob: URL an <img> can use directly. staleTime: Infinity
 * because artifact content never changes once uploaded, so there's no
 * reason to refetch or recreate the blob URL for the same id. Blob URLs
 * aren't explicitly revoked (that would need an unmount effect this hook
 * deliberately doesn't have) — the browser reclaims them on navigation,
 * and a single review screen only ever holds a handful at once.
 */
export function useArtifactAccess(artifactId) {
  const api = useApiClient();
  const query = useQuery({
    queryKey: ["artifact-access", artifactId],
    queryFn: async () => {
      const { access } = await api.getArtifactAccess(artifactId);
      const response = await fetch(access.url, {
        method: access.method,
        headers: access.headers,
      });
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    },
    enabled: Boolean(artifactId),
    staleTime: Infinity,
  });

  return { url: query.data ?? null, isLoading: query.isLoading };
}
