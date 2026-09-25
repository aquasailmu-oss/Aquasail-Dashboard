import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";

/** Placeholder for a navigation destination whose work package has not landed yet. */
export function ComingSoon({ title, description, arrives }: { title: string; description: string; arrives: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="text-muted-foreground p-10 text-center">This screen arrives in {arrives}.</CardContent>
      </Card>
    </>
  );
}
