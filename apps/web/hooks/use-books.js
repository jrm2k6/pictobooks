import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useApiClient, UnauthorizedError } from '../api-client.js';

/**
 * Query hook: load the signed-in customer's book library.
 * Redirects to /sign-in on 401.
 *
 * @returns {import('@tanstack/react-query').UseQueryResult<import('../api-client.js').BookSummary[]>}
 */
export function useBooks() {
  const api = useApiClient();
  const navigate = useNavigate();

  return useQuery({
    queryKey: ['books'],
    queryFn: async () => {
      try {
        const data = await api.listBooks();
        return data.books ?? [];
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          navigate({ to: '/sign-in' });
          return [];
        }
        throw err;
      }
    },
  });
}
