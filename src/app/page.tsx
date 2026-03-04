import { DashboardClient } from "@/components/dashboard/DashboardClient";

export default function Home() {
  return (
    <>
      <div className="logo-bg" aria-hidden />
      <div className="relative z-10 min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <DashboardClient />
      </div>
    </>
  );
}
