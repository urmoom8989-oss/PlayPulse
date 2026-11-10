import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ResultsSkeleton, ResultsView } from "@/components/search/ResultsView";
import { cleanTag } from "@/lib/watch/richtext";

// /hashtag/<tag>, where a #hashtag in a description leads, like 2020: the
// videos found for the tag, under a big #tag title.
export async function generateMetadata({ params }: PageProps<"/hashtag/[tag]">) {
  const tag = cleanTag((await params).tag);
  return { title: tag ? `#${tag} | PlayPulse` : "Hashtag | PlayPulse" };
}

export default function HashtagPage({ params }: PageProps<"/hashtag/[tag]">) {
  return (
    <Suspense fallback={<ResultsSkeleton />}>
      <Hashtag params={params} />
    </Suspense>
  );
}

async function Hashtag({ params }: { params: PageProps<"/hashtag/[tag]">["params"] }) {
  const tag = cleanTag((await params).tag);
  if (!tag) notFound();
  return <ResultsView heading={`#${tag}`} searchParams={Promise.resolve({ search_query: `#${tag}`, exact: "1" })} />;
}
