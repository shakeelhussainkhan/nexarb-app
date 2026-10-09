import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import AdminClient from "./AdminClient";

export const metadata = {
  title: "Admin — NexArb",
};

const ADMIN_EMAIL = "shakeelhussain.khan@gmail.com";

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId) redirect("/login");

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? "";

  if (email !== ADMIN_EMAIL) redirect("/dashboard");

  // Fetch data server-side
  let users: Record<string, unknown>[] = [];
  let waitlist: Record<string, unknown>[] = [];

  try {
    const { data: usersData } = await getSupabaseAdmin()
      .from("nexarb_users")
      .select("*")
      .order("created_at", { ascending: false });
    users = usersData ?? [];
  } catch { /* ignore */ }

  try {
    const { data: waitlistData } = await getSupabaseAdmin()
      .from("nexarb_waitlist")
      .select("*")
      .order("created_at", { ascending: false });
    waitlist = waitlistData ?? [];
  } catch { /* ignore */ }

  return <AdminClient users={users} waitlist={waitlist} />;
}
