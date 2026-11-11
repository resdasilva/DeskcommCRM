"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

interface Confirmacao {
  contact_id: string;
  conversation_id: string;
  turn_requested: boolean;
  message: string;
}

/** "É cliente, responder": confirma o contato e pede o turno de novo (issue #10). */
export function useConfirmClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) =>
      apiClient
        .post<{ data: Confirmacao }>(`/api/v1/conversations/${conversationId}/client-confirmed`, {})
        .then((r) => r.data),
    onError: showApiError,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["agent-inbox"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
