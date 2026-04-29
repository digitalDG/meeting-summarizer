import { createClient } from "@deepgram/sdk";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "DEEPGRAM_API_KEY not configured" }, { status: 500 });
  }

  try {
    const deepgram = createClient(apiKey);

    const { result: projectsResult, error: projectsError } = await deepgram.manage.getProjects();
    if (projectsError) throw new Error(`Failed to get projects: ${JSON.stringify(projectsError)}`);

    const project = projectsResult?.projects?.[0];
    if (!project) throw new Error("No Deepgram projects found");

    const { result: keyResult, error: keyError } = await deepgram.manage.createProjectKey(
      project.project_id,
      {
        comment: "browser-session",
        scopes: ["usage:write"],
        time_to_live_in_seconds: 60,
      }
    );

    if (keyError) throw new Error(`Failed to create key: ${JSON.stringify(keyError)}`);
    if (!keyResult?.key) throw new Error("No key returned from Deepgram");

    return NextResponse.json({ key: keyResult.key });
  } catch (err) {
    console.error("[deepgram-token]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
