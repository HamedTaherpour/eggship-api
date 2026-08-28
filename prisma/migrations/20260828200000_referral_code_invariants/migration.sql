-- REF-02: defend canonical referral-code shape and preserve code identity.
ALTER TABLE "Visitor"
  ADD CONSTRAINT "Visitor_referral_code_check"
  CHECK ("referralCode" ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,10}$');

ALTER TABLE "ReferralAttribution"
  ADD CONSTRAINT "ReferralAttribution_referral_code_check"
  CHECK ("referralCode" ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,10}$');

CREATE FUNCTION "prevent_visitor_referral_code_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."referralCode" IS DISTINCT FROM OLD."referralCode" THEN
    RAISE EXCEPTION 'Visitor referral codes are immutable.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Visitor_referral_code_immutable"
BEFORE UPDATE OF "referralCode" ON "Visitor"
FOR EACH ROW
EXECUTE FUNCTION "prevent_visitor_referral_code_change"();
