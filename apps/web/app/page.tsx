import { Suspense } from "react";

import { SessionWorkbench } from "./_components/session-workbench";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <SessionWorkbench />
    </Suspense>
  );
}
