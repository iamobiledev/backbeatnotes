CREATE UNIQUE INDEX "workspace_members_single_owner_uidx" ON "workspace_members" USING btree ("workspace_id") WHERE "workspace_members"."role" = 'owner';--> statement-breakpoint
CREATE OR REPLACE FUNCTION transfer_workspace_ownership(
  p_workspace_id text,
  p_actor_user_id text,
  p_target_user_id text
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_personal boolean;
  v_actor_role workspace_role;
  v_target_role workspace_role;
BEGIN
  IF p_actor_user_id = p_target_user_id THEN
    RETURN 'CANNOT_TRANSFER_TO_SELF';
  END IF;

  SELECT w.is_personal
    INTO v_is_personal
    FROM workspaces AS w
   WHERE w.id = p_workspace_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF v_is_personal THEN
    RETURN 'PERSONAL_WORKSPACE';
  END IF;

  SELECT wm.role
    INTO v_actor_role
    FROM workspace_members AS wm
   WHERE wm.workspace_id = p_workspace_id
     AND wm.user_id = p_actor_user_id
   FOR UPDATE;

  IF NOT FOUND OR v_actor_role <> 'owner' THEN
    RETURN 'OWNER_ONLY';
  END IF;

  SELECT wm.role
    INTO v_target_role
    FROM workspace_members AS wm
   WHERE wm.workspace_id = p_workspace_id
     AND wm.user_id = p_target_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'TRANSFER_TARGET_NOT_MEMBER';
  END IF;
  IF v_target_role = 'owner' THEN
    RETURN 'ALREADY_OWNER';
  END IF;

  UPDATE workspace_members
     SET role = 'admin',
         updated_at = now()
   WHERE workspace_id = p_workspace_id
     AND user_id = p_actor_user_id;

  UPDATE workspace_members
     SET role = 'owner',
         updated_at = now()
   WHERE workspace_id = p_workspace_id
     AND user_id = p_target_user_id;

  UPDATE workspaces
     SET created_by_id = p_target_user_id,
         updated_at = now()
   WHERE id = p_workspace_id;

  RETURN 'OK';
END;
$$;