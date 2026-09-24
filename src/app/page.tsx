import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { landingPath } from "@/lib/navigation";

export default async function Home() {
  const user = await requireUser();
  redirect(landingPath(user.role));
}
