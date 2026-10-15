-- 021: Add 'awaiting_payment' to the alibaba_orders status CHECK (2026-10-15).
-- PR #68 (Alibaba placement rewrite) introduced the `awaiting_payment`
-- state in the app code: once /buynow/order/create succeeds, the order
-- exists on Alibaba but is UNPAID — there is no headless API payment, so
-- the founder pays at Alibaba's cashier via the stored pay link, and the
-- order sits in awaiting_payment until the pay-result sync confirms
-- PAY_SUCCESS. Migration 020's status CHECK was never widened to include
-- it, so the place route's write of status='awaiting_payment' violated
-- the constraint and failed — leaving the local row at 'approved' with
-- no trade id recorded even though the order had been created on
-- Alibaba. This migration re-adds the CHECK with the full lifecycle
-- including 'awaiting_payment'. Idempotent: safe to re-run.

alter table public.alibaba_orders
  drop constraint if exists alibaba_orders_status_check;

do $$
begin
  alter table public.alibaba_orders
    add constraint alibaba_orders_status_check
    check (status in ('draft', 'pending_approval', 'approved', 'ready_to_place',
                      'awaiting_payment', 'placed', 'shipped', 'delivered',
                      'failed', 'cancelled'));
exception when duplicate_object then null;
end $$;
