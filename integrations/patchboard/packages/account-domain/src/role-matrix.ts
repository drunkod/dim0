// EXACT 67×5 pinned Teable source allow/deny cells. Generated once from
// docs account role-source-matrix-67.csv at audited bd8cfc... pin.
// Source matrix is not sufficient without independent service guards.
export const ROLE_ACTION_ROWS = {
  "app|create": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "app|delete": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "app|read": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "app|update": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "automation|create": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "automation|delete": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "automation|read": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "automation|update": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "base|authority_matrix_config": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "base|create": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "base|delete": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "base|invite_email": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "base|invite_link": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "base|query_data": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "deny",
    "viewer": "allow"
  },
  "base|read": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "base|read_all": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "base|table_export": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "base|table_import": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "deny",
    "viewer": "deny"
  },
  "base|update": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "enterprise|read": {
    "owner": "deny",
    "creator": "deny",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "enterprise|update": {
    "owner": "deny",
    "creator": "deny",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "field|create": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "field|delete": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "field|read": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "field|update": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "instance|read": {
    "owner": "deny",
    "creator": "deny",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "instance|update": {
    "owner": "deny",
    "creator": "deny",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "record|archive": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "deny",
    "viewer": "deny"
  },
  "record|comment": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "deny"
  },
  "record|copy": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "record|create": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "deny",
    "viewer": "deny"
  },
  "record|delete": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "deny",
    "viewer": "deny"
  },
  "record|read": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "record|update": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "deny",
    "viewer": "deny"
  },
  "routine|create": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "routine|delete": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "routine|read": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "routine|update": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "space|create": {
    "owner": "allow",
    "creator": "deny",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "space|delete": {
    "owner": "allow",
    "creator": "deny",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "space|grant_role": {
    "owner": "allow",
    "creator": "deny",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "space|invite_email": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "space|invite_link": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "space|read": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "space|update": {
    "owner": "allow",
    "creator": "deny",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "table_record_history|read": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "deny",
    "viewer": "deny"
  },
  "table|archive_manage": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "table|archive_read": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "deny",
    "viewer": "deny"
  },
  "table|create": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "table|delete": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "table|export": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "table|import": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "deny",
    "viewer": "deny"
  },
  "table|read": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "table|trash_read": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "deny",
    "viewer": "deny"
  },
  "table|trash_reset": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "table|trash_update": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "deny",
    "viewer": "deny"
  },
  "table|update": {
    "owner": "allow",
    "creator": "allow",
    "editor": "deny",
    "commenter": "deny",
    "viewer": "deny"
  },
  "user|email_read": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "user|integrations": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "user|notifications_send": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "user|self_hosted_licenses_read": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "user|spaces_read": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "view|create": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "deny",
    "viewer": "deny"
  },
  "view|delete": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "deny",
    "viewer": "deny"
  },
  "view|read": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "allow",
    "viewer": "allow"
  },
  "view|share": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "deny",
    "viewer": "deny"
  },
  "view|update": {
    "owner": "allow",
    "creator": "allow",
    "editor": "allow",
    "commenter": "deny",
    "viewer": "deny"
  }
} as const;
export type TeableAction = keyof typeof ROLE_ACTION_ROWS;
export type TeableRole = keyof (typeof ROLE_ACTION_ROWS)[TeableAction];
