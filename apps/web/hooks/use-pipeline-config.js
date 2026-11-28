import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "../api-client.js";
import { normalizePipelineConfig } from "../alpha-limits.js";

/**
 * Query hook: load server-driven pipeline limits (photo bounds, book cap).
 * Returns safe fallback defaults while loading or if the request fails.
 *
 * @returns {{ minPhotosPerRun: number, maxPhotosPerRun: number, maxBooksPerUser: number | null }}
 */
export function usePipelineConfig() {
  const api = useApiClient();

  const { data } = useQuery({
    queryKey: ["pipeline-config"],
    queryFn: () => api.getPipelineConfig(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return normalizePipelineConfig(data);
}
