export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_users: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_runs: {
        Row: {
          audit_type: string
          client_id: string
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          input: Json
          organization_id: string
          result: Json | null
          started_at: string | null
          status: Database["public"]["Enums"]["audit_status"]
          triggered_by: string
          updated_at: string
        }
        Insert: {
          audit_type?: string
          client_id: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          organization_id: string
          result?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["audit_status"]
          triggered_by: string
          updated_at?: string
        }
        Update: {
          audit_type?: string
          client_id?: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          organization_id?: string
          result?: Json | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["audit_status"]
          triggered_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_integrations: {
        Row: {
          client_id: string
          config: Json
          created_at: string
          enabled: boolean
          id: string
          organization_id: string
          provider: string
          updated_at: string
        }
        Insert: {
          client_id: string
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          organization_id: string
          provider: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          organization_id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_integrations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          canonry_project: string | null
          country: string | null
          created_at: string
          created_by: string
          domain: string | null
          ga4_property: string | null
          google_ads_customer: string | null
          gsc_property: string | null
          id: string
          industry: string | null
          language: string
          metadata: Json
          name: string
          notes: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          canonry_project?: string | null
          country?: string | null
          created_at?: string
          created_by: string
          domain?: string | null
          ga4_property?: string | null
          google_ads_customer?: string | null
          gsc_property?: string | null
          id?: string
          industry?: string | null
          language?: string
          metadata?: Json
          name: string
          notes?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          canonry_project?: string | null
          country?: string | null
          created_at?: string
          created_by?: string
          domain?: string | null
          ga4_property?: string | null
          google_ads_customer?: string | null
          gsc_property?: string | null
          id?: string
          industry?: string | null
          language?: string
          metadata?: Json
          name?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          author: string | null
          body: string | null
          client_id: string
          content_type: Database["public"]["Enums"]["content_type"]
          created_at: string
          created_by: string | null
          customer_id: string | null
          hub: string | null
          id: string
          intent: string | null
          keyword_volume: number | null
          keywords: string[] | null
          language: string
          last_refresh_at: string | null
          primary_keyword: string | null
          published_at: string | null
          source: string | null
          status: Database["public"]["Enums"]["content_status"]
          target_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          author?: string | null
          body?: string | null
          client_id: string
          content_type?: Database["public"]["Enums"]["content_type"]
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          hub?: string | null
          id?: string
          intent?: string | null
          keyword_volume?: number | null
          keywords?: string[] | null
          language?: string
          last_refresh_at?: string | null
          primary_keyword?: string | null
          published_at?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          target_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          author?: string | null
          body?: string | null
          client_id?: string
          content_type?: Database["public"]["Enums"]["content_type"]
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          hub?: string | null
          id?: string
          intent?: string | null
          keyword_volume?: number | null
          keywords?: string[] | null
          language?: string
          last_refresh_at?: string | null
          primary_keyword?: string | null
          published_at?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          target_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      content_metrics: {
        Row: {
          ai_citations: number | null
          backlinks: number | null
          captured_on: string
          clicks: number
          content_item_id: string
          conversions: number
          ctr: number | null
          impressions: number
          position: number | null
          sessions: number
        }
        Insert: {
          ai_citations?: number | null
          backlinks?: number | null
          captured_on?: string
          clicks?: number
          content_item_id: string
          conversions?: number
          ctr?: number | null
          impressions?: number
          position?: number | null
          sessions?: number
        }
        Update: {
          ai_citations?: number | null
          backlinks?: number | null
          captured_on?: string
          clicks?: number
          content_item_id?: string
          conversions?: number
          ctr?: number | null
          impressions?: number
          position?: number | null
          sessions?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_metrics_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_decision"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_metrics_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_defaults: {
        Row: {
          client_id: string | null
          defaults: Json
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          defaults?: Json
          id?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          defaults?: Json
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_defaults_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_defaults_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_tool_settings: {
        Row: {
          config: Json | null
          customer_id: string
          enabled: boolean
          id: string
          tool_key: string
          updated_at: string
        }
        Insert: {
          config?: Json | null
          customer_id: string
          enabled?: boolean
          id?: string
          tool_key: string
          updated_at?: string
        }
        Update: {
          config?: Json | null
          customer_id?: string
          enabled?: boolean
          id?: string
          tool_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_tool_settings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          company: string | null
          created_at: string
          created_by: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notes: {
        Row: {
          content: string
          created_at: string
          created_by: string
          customer_id: string | null
          id: string
          task_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          created_by: string
          customer_id?: string | null
          id?: string
          task_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          customer_id?: string | null
          id?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_connections: {
        Row: {
          access_token: string | null
          account_email: string | null
          client_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          metadata: Json
          organization_id: string
          provider: string
          refresh_token: string | null
          scopes: string[] | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token?: string | null
          account_email?: string | null
          client_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          provider: string
          refresh_token?: string | null
          scopes?: string[] | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token?: string | null
          account_email?: string | null
          client_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          provider?: string
          refresh_token?: string | null
          scopes?: string[] | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_connections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          dashboard_config: Json
          id: string
          monthly_ai_budget_usd: number
          name: string
          plan: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          dashboard_config?: Json
          id?: string
          monthly_ai_budget_usd?: number
          name: string
          plan?: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          dashboard_config?: Json
          id?: string
          monthly_ai_budget_usd?: number
          name?: string
          plan?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          description: string | null
          due_date: string | null
          id: string
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      content_decision: {
        Row: {
          age_days: number | null
          author: string | null
          clicks_28: number | null
          client_id: string | null
          gate: string | null
          hub: string | null
          id: string | null
          impr_28: number | null
          language: string | null
          last_refresh_at: string | null
          peak_clicks_28: number | null
          peak_position: number | null
          position_28: number | null
          primary_keyword: string | null
          published_at: string | null
          recommendation: string | null
          status: string | null
          title: string | null
          trend: string | null
          url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_access_client: { Args: { _client_id: string }; Returns: boolean }
      can_run_audits: { Args: { _org: string }; Returns: boolean }
      get_content_dashboard: {
        Args: { p_client_id: string }
        Returns: {
          age_days: number | null
          author: string | null
          clicks_28: number | null
          client_id: string | null
          gate: string | null
          hub: string | null
          id: string | null
          impr_28: number | null
          language: string | null
          last_refresh_at: string | null
          peak_clicks_28: number | null
          peak_position: number | null
          position_28: number | null
          primary_keyword: string | null
          published_at: string | null
          recommendation: string | null
          status: string | null
          title: string | null
          trend: string | null
          url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "content_decision"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_admin: { Args: { _org: string }; Returns: boolean }
      is_org_member: { Args: { _org: string }; Returns: boolean }
      org_ai_spend_this_month: { Args: { _org: string }; Returns: number }
      org_role_of: {
        Args: { _org: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
    }
    Enums: {
      app_role: "admin" | "member"
      audit_status: "pending" | "running" | "succeeded" | "failed"
      content_status: "draft" | "review" | "published" | "archived"
      content_type:
        | "blog"
        | "landing"
        | "geo"
        | "social"
        | "other"
        | "audit"
        | "note"
        | "report"
        | "win"
      org_role: "owner" | "admin" | "member" | "viewer"
      task_priority: "low" | "medium" | "high"
      task_status: "open" | "in_progress" | "done"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "member"],
      audit_status: ["pending", "running", "succeeded", "failed"],
      content_status: ["draft", "review", "published", "archived"],
      content_type: [
        "blog",
        "landing",
        "geo",
        "social",
        "other",
        "audit",
        "note",
        "report",
        "win",
      ],
      org_role: ["owner", "admin", "member", "viewer"],
      task_priority: ["low", "medium", "high"],
      task_status: ["open", "in_progress", "done"],
    },
  },
} as const
