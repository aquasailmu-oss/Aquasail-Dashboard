export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activities: {
        Row: {
          code: string
          created_at: string
          default_duration_minutes: number | null
          description: string | null
          id: string
          is_active: boolean
          is_redeemable: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          default_duration_minutes?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_redeemable?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          default_duration_minutes?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_redeemable?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["app_role"] | null
          changed_at: string
          id: number
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["app_role"] | null
          changed_at?: string
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["app_role"] | null
          changed_at?: string
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      booking_activities: {
        Row: {
          activity_id: string
          booking_id: string
          created_at: string
          id: string
          quantity: number
          source_item_id: string | null
        }
        Insert: {
          activity_id: string
          booking_id: string
          created_at?: string
          id?: string
          quantity: number
          source_item_id?: string | null
        }
        Update: {
          activity_id?: string
          booking_id?: string
          created_at?: string
          id?: string
          quantity?: number
          source_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_activities_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_activities_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_activities_source_item_id_fkey"
            columns: ["source_item_id"]
            isOneToOne: false
            referencedRelation: "booking_items"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_items: {
        Row: {
          activity_id: string | null
          booking_id: string
          commission_cents: number
          commission_rate: number | null
          created_at: string
          discount_cents: number
          discount_reason: string | null
          id: string
          line_type: string
          package_id: string | null
          participant_type: Database["public"]["Enums"]["participant_type"]
          price_rule_id: string | null
          quantity: number
          sort_order: number
          unit_charged_cents: number
          unit_operator_net_cents: number | null
          unit_retail_cents: number
          updated_at: string
        }
        Insert: {
          activity_id?: string | null
          booking_id: string
          commission_cents?: number
          commission_rate?: number | null
          created_at?: string
          discount_cents?: number
          discount_reason?: string | null
          id?: string
          line_type: string
          package_id?: string | null
          participant_type: Database["public"]["Enums"]["participant_type"]
          price_rule_id?: string | null
          quantity: number
          sort_order?: number
          unit_charged_cents: number
          unit_operator_net_cents?: number | null
          unit_retail_cents: number
          updated_at?: string
        }
        Update: {
          activity_id?: string | null
          booking_id?: string
          commission_cents?: number
          commission_rate?: number | null
          created_at?: string
          discount_cents?: number
          discount_reason?: string | null
          id?: string
          line_type?: string
          package_id?: string | null
          participant_type?: Database["public"]["Enums"]["participant_type"]
          price_rule_id?: string | null
          quantity?: number
          sort_order?: number
          unit_charged_cents?: number
          unit_operator_net_cents?: number | null
          unit_retail_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_items_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_items_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_items_price_rule_id_fkey"
            columns: ["price_rule_id"]
            isOneToOne: false
            referencedRelation: "price_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_participants: {
        Row: {
          booking_id: string
          count: number
          created_at: string
          id: string
          participant_type: Database["public"]["Enums"]["participant_type"]
          updated_at: string
        }
        Insert: {
          booking_id: string
          count: number
          created_at?: string
          id?: string
          participant_type: Database["public"]["Enums"]["participant_type"]
          updated_at?: string
        }
        Update: {
          booking_id?: string
          count?: number
          created_at?: string
          id?: string
          participant_type?: Database["public"]["Enums"]["participant_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_participants_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_sequences: {
        Row: {
          last_number: number
          service_date: string
        }
        Insert: {
          last_number?: number
          service_date: string
        }
        Update: {
          last_number?: number
          service_date?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          charged_total_cents: number
          client_id: string
          commission_total_cents: number
          created_at: string
          created_by: string | null
          departure_time: string | null
          discount_total_cents: number
          id: string
          idempotency_key: string | null
          meeting_point: string | null
          notes: string | null
          operator_id: string | null
          operator_net_total_cents: number
          payer: string
          reference: string
          resource_id: string | null
          retail_total_cents: number
          service_date: string
          source_type: string
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          charged_total_cents?: number
          client_id: string
          commission_total_cents?: number
          created_at?: string
          created_by?: string | null
          departure_time?: string | null
          discount_total_cents?: number
          id?: string
          idempotency_key?: string | null
          meeting_point?: string | null
          notes?: string | null
          operator_id?: string | null
          operator_net_total_cents?: number
          payer?: string
          reference: string
          resource_id?: string | null
          retail_total_cents?: number
          service_date: string
          source_type: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          charged_total_cents?: number
          client_id?: string
          commission_total_cents?: number
          created_at?: string
          created_by?: string | null
          departure_time?: string | null
          discount_total_cents?: number
          id?: string
          idempotency_key?: string | null
          meeting_point?: string | null
          notes?: string | null
          operator_id?: string | null
          operator_net_total_cents?: number
          payer?: string
          reference?: string
          resource_id?: string | null
          retail_total_cents?: number
          service_date?: string
          source_type?: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "tour_operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          country: string | null
          created_at: string
          created_by: string | null
          email: string | null
          first_name: string
          id: string
          last_name: string
          notes: string | null
          phone_e164: string | null
          search_text: string | null
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          first_name: string
          id?: string
          last_name: string
          notes?: string | null
          phone_e164?: string | null
          search_text?: string | null
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string
          notes?: string | null
          phone_e164?: string | null
          search_text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      package_activities: {
        Row: {
          activity_id: string
          created_at: string
          id: string
          is_optional: boolean
          package_id: string
          quantity_per_participant: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          activity_id: string
          created_at?: string
          id?: string
          is_optional?: boolean
          package_id: string
          quantity_per_participant?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          activity_id?: string
          created_at?: string
          id?: string
          is_optional?: boolean
          package_id?: string
          quantity_per_participant?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_activities_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_activities_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          pricing_mode: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          pricing_mode: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          pricing_mode?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_cents: number
          booking_id: string
          corrects_payment_id: string | null
          created_at: string
          id: string
          is_correction: boolean
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          received_at: string
          received_from: string
          recorded_by: string | null
          reference: string | null
        }
        Insert: {
          amount_cents: number
          booking_id: string
          corrects_payment_id?: string | null
          created_at?: string
          id?: string
          is_correction?: boolean
          method: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          received_at?: string
          received_from: string
          recorded_by?: string | null
          reference?: string | null
        }
        Update: {
          amount_cents?: number
          booking_id?: string
          corrects_payment_id?: string | null
          created_at?: string
          id?: string
          is_correction?: boolean
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          received_at?: string
          received_from?: string
          recorded_by?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_corrects_payment_id_fkey"
            columns: ["corrects_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      price_rules: {
        Row: {
          activity_id: string | null
          audience: Database["public"]["Enums"]["price_audience"]
          commission_rate: number | null
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          net_cents: number | null
          operator_id: string | null
          package_id: string | null
          participant_type: Database["public"]["Enums"]["participant_type"]
          retail_cents: number
          scope: string
        }
        Insert: {
          activity_id?: string | null
          audience: Database["public"]["Enums"]["price_audience"]
          commission_rate?: number | null
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          net_cents?: number | null
          operator_id?: string | null
          package_id?: string | null
          participant_type: Database["public"]["Enums"]["participant_type"]
          retail_cents: number
          scope: string
        }
        Update: {
          activity_id?: string | null
          audience?: Database["public"]["Enums"]["price_audience"]
          commission_rate?: number | null
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          net_cents?: number | null
          operator_id?: string | null
          package_id?: string | null
          participant_type?: Database["public"]["Enums"]["participant_type"]
          retail_cents?: number
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_rules_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_rules_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "tour_operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_rules_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      resources: {
        Row: {
          capacity: number
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          resource_type: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          capacity: number
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          resource_type: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          capacity?: number
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          resource_type?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      tickets: {
        Row: {
          booking_id: string
          id: string
          issued_at: string
          printed_count: number
          token: string
        }
        Insert: {
          booking_id: string
          id?: string
          issued_at?: string
          printed_count?: number
          token?: string
        }
        Update: {
          booking_id?: string
          id?: string
          issued_at?: string
          printed_count?: number
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      tour_operators: {
        Row: {
          code: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          default_commission_rate: number | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          payer: string
          settlement_model: string
          updated_at: string
        }
        Insert: {
          code: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          default_commission_rate?: number | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          payer?: string
          settlement_model: string
          updated_at?: string
        }
        Update: {
          code?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          default_commission_rate?: number | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          payer?: string
          settlement_model?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_list_users: {
        Args: never
        Returns: {
          created_at: string
          email: string
          full_name: string
          id: string
          invite_pending: boolean
          is_active: boolean
          last_sign_in_at: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      create_booking: { Args: { payload: Json }; Returns: Json }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      has_role: {
        Args: { roles: Database["public"]["Enums"]["app_role"][] }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      next_booking_reference: {
        Args: { p_service_date: string }
        Returns: string
      }
      set_price: {
        Args: {
          p_activity_id?: string
          p_audience: Database["public"]["Enums"]["price_audience"]
          p_commission_rate?: number
          p_effective_from: string
          p_net_cents?: number
          p_operator_id?: string
          p_package_id?: string
          p_participant_type: Database["public"]["Enums"]["participant_type"]
          p_retail_cents: number
          p_scope: string
        }
        Returns: string
      }
      today_mauritius: { Args: never; Returns: string }
    }
    Enums: {
      app_role: "admin" | "accountant" | "receptionist" | "activity_staff"
      booking_status: "confirmed" | "cancelled" | "no_show" | "completed"
      participant_type: "adult" | "child" | "infant"
      payment_method:
        | "cash"
        | "card"
        | "bank_transfer"
        | "operator_account"
        | "other"
      price_audience: "walk_in" | "operator"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "accountant", "receptionist", "activity_staff"],
      booking_status: ["confirmed", "cancelled", "no_show", "completed"],
      participant_type: ["adult", "child", "infant"],
      payment_method: [
        "cash",
        "card",
        "bank_transfer",
        "operator_account",
        "other",
      ],
      price_audience: ["walk_in", "operator"],
    },
  },
} as const

