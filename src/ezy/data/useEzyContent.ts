import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type EzyContentItem = {
  id: string;
  title: string;
  clientId: string;
  type: "blog" | "audit" | "note" | "report" | "win";
  status: "draft" | "published" | "archived";
  content: string;
  keywords: string[];
  wordCount: number;
  toolId: string;
  createdAt: string;
  updatedAt: string;
};

const ALLOWED_TYPES = ["blog", "audit", "note", "report", "win"] as const;

function rowToItem(r: any): EzyContentItem {
  const body = String(r.body ?? "");
  const type = ALLOWED_TYPES.includes(r.content_type) ? r.content_type : "blog";
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    clientId: String(r.client_id ?? ""),
    type,
    status: r.status === "published" ? "published" : r.status === "archived" ? "archived" : "draft",
    content: body,
    keywords: Array.isArray(r.keywords) ? r.keywords.map(String) : [],
    wordCount: body.trim() ? body.trim().split(/\s+/).length : 0,
    toolId: "",
    createdAt: String(r.created_at ?? "").slice(0, 10),
    updatedAt: String(r.updated_at ?? "").slice(0, 10),
  };
}

export function useEzyContent() {
  const { organizationId, user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<EzyContentItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!organizationId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: clientRows } = await supabase
      .from("clients")
      .select("id")
      .eq("organization_id", organizationId);
    const clientIds = (clientRows ?? []).map((c) => c.id);
    if (!clientIds.length) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("content_items")
      .select("*")
      .in("client_id", clientIds)
      .order("updated_at", { ascending: false });
    setItems((data ?? []).map(rowToItem));
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    if (!authLoading) void reload();
  }, [authLoading, reload]);

  const updateContent = useCallback(async (id: string, content: string) => {
    const { data, error } = await supabase
      .from("content_items")
      .update({ body: content })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    const mapped = rowToItem(data);
    setItems((p) => p.map((i) => (i.id === id ? mapped : i)));
    return mapped;
  }, []);

  const create = useCallback(
    async (input: Partial<EzyContentItem> & { clientId: string; title: string }) => {
      if (!user) throw new Error("Nicht eingeloggt");
      const { data, error } = await supabase
        .from("content_items")
        .insert({
          client_id: input.clientId,
          created_by: user.id,
          title: input.title,
          body: input.content ?? "",
          content_type: (input.type ?? "blog") as any,
          status: (input.status ?? "draft") as any,
          keywords: input.keywords ?? [],
        })
        .select()
        .single();
      if (error) throw error;
      const mapped = rowToItem(data);
      setItems((p) => [mapped, ...p]);
      return mapped;
    },
    [user],
  );

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("content_items").delete().eq("id", id);
    if (error) throw error;
    setItems((p) => p.filter((i) => i.id !== id));
  }, []);

  return { items, loading, reload, updateContent, create, remove };
}
