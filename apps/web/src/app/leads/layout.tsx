import "./leads.css";
import { LeadsShell } from "@/components/leads/LeadsShell";

export default function LeadsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <LeadsShell>{children}</LeadsShell>;
}
