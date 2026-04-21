import { Suspense } from "react";

import { UI1Workbench } from "./_components/ui1-workbench";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <UI1Workbench />
    </Suspense>
  );
}
