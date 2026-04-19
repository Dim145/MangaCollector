import { useQuery } from "@tanstack/react-query";
import { getAuthProvider } from "@/utils/auth.js";

export function useAuthProvider() {
  const { data } = useQuery({
    queryKey: ["auth-provider"],
    queryFn: getAuthProvider,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? { authName: "", authIcon: "" };
}
