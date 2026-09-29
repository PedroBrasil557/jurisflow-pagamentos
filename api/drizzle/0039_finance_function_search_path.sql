-- Hardening das funcoes financeiras criadas pela 0038.
-- Mantem resolucao de nomes restrita ao schema public e pg_temp para evitar
-- search_path mutavel no PostgreSQL/Supabase.
ALTER FUNCTION public.finance_adjustment_after_insert() SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.finance_adjustment_before_insert() SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.finance_closing_guard() SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.finance_closing_item_guard() SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.finance_credit_guard() SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.finance_credit_refresh(text) SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.finance_payout_after_change() SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.finance_payout_before_insert() SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.finance_receipt_guard() SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.finance_reserve_balance_check() SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.finance_reserve_lock() SET search_path = public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.finance_rule_guard() SET search_path = public, pg_temp;
