import { pgTable, integer, primaryKey } from "drizzle-orm/pg-core";
import { roles } from "./roles";
import { pages } from "./pages";

export const rolePages = pgTable(
    "role_pages",
    {
        roleId: integer("role_id")
            .notNull()
            .references(() => roles.id, { onDelete: "cascade" }),
        pageId: integer("page_id")
            .notNull()
            .references(() => pages.id, { onDelete: "cascade" }),
        position: integer("position").notNull(),
    },
    (t) => [primaryKey({ columns: [t.roleId, t.pageId] })]
);

export type RolePage = typeof rolePages.$inferSelect;
export type NewRolePage = typeof rolePages.$inferInsert;
