"use server";

import { nanoid, embed } from "ai";
import { createAI, getMutableAIState, streamUI } from "ai/rsc";
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { z } from "zod";
import { DataAPIClient } from "@datastax/astra-db-ts";
import { Movies } from "./Movies";
import { IntegrationSpinner } from "./IntegrationSpinner";
import { Player } from "./Player";
import { Markdown } from "./Markdown";
import { ForgotPassword } from "./ForgotPassword";
import { Map } from "./Map";

let lastLangflowResponse = "";

const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  sessionToken: process.env.AWS_SESSION_TOKEN,
});

export const Ai = createAI({
  actions: {
    continueConversation: async ({ content }: any) => {
      const history = getMutableAIState();
      const result = await streamUI({
        model: bedrock('anthropic.claude-3-sonnet-20240229-v1:0'),
        messages: [...history.get(), { role: "user", content }],
        text: ({ content, done }) => {
          if (done) {
            history.done([
              ...history.get(),
              { role: "user", content },
              { role: "assistant", content}
            ]);
          }
          return <Markdown>{content}</Markdown>;
        },
        tools: {
          showForgotPassword: {
            description:
              "When the user says they forgot their password, use this tool",
            parameters: z.object({}),
            generate: async function* () {
              return <ForgotPassword />;
            },
          },
          getMovies: {
            description:
              "A tool used to get a list of movies matching a user's query",
            parameters: z.object({
              query: z.string(),
            }),
            generate: async function* ({ query }) {
              console.log("Looking for movies", { query });
              yield (
                <div className="flex items-center gap-4">
                  <IntegrationSpinner /> Asking Langflow...
                </div>
              );

              const langflowResponse = await fetch(
                process.env.LANGFLOW_URL!,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${process.env.LANGFLOW_API_KEY}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    output_type: "chat",
                    input_type: "chat",
                    input_value: query,
                  }),
                }
              )
                .then((r) => r.json())
                .then((d) => {
                  console.dir({ d }, { depth: Infinity });
                  const result =
                    d.outputs[0].outputs[0].results.message.data.text;

                  console.dir(result, { depth: null });
                  return result;
                });

              const parseResponse = function(response: string) {
                const movies = response.split("\n").filter((movie) => movie.trim() !== "" && (movie.startsWith("* ") || movie.startsWith("- "))).map(title => title.replace(/^[*-] /, "")).join("\n");
                return movies;

              }
              lastLangflowResponse = parseResponse(langflowResponse);

              history.done([
                ...history.get(),
                { role: "user", content },
                {
                  role: "assistant",
                  content: `Movies are: ${lastLangflowResponse}`,
                },
              ]);

              return (
                <ul>
                  {lastLangflowResponse.split("\n").map((movie, index) => (
                    <li key={index}>
                      <Markdown>{movie.trim()}</Markdown>
                    </li>
                  ))}
                </ul>
              );
            },
          },
          showMap: {
            description:
              "When the user asks for a location where to watch movies, use this tool",
            parameters: z.object({ movieName: z.string() }),
            generate: async function* () {
              return <Map apiKey={process.env.GOOGLE_MAPS_API_KEY!} />;
            },
          },
          showTrailer: {
            description: "When the user asks for a trailer, use this tool",
            parameters: z.object({
              movieName: z.string(),
            }),
            generate: async function* ({ movieName }) {
              const client = new DataAPIClient(
                process.env.ASTRA_DB_APPLICATION_TOKEN!
              );
              const db = client.db(process.env.ASTRA_DB_API_ENDPOINT!);

              yield (
                <div className="flex items-center gap-4">
                  <IntegrationSpinner /> Getting more info about {movieName}...
                </div>
              );
              const { embedding } = await embed({
                model: bedrock.embedding("amazon.titan-embed-text-v2:0"),
                value: movieName,
              });
              const movie: any = await db
                .collection("movies")
                .findOne({}, { sort: { $vector: embedding }});

              yield (
                <div className="flex items-center gap-4">
                  <IntegrationSpinner /> Found movie, getting trailer...
                </div>
              );
              const trailer = await fetch(
                `https://api.themoviedb.org/3/movie/${movie._id}/videos?language=en-US&api_key=${process.env.TMDB_API_KEY}`
              )
                .then((r) => r.json())
                .then(
                  (d) =>
                    d.results.find(
                      (v: { type: string }) =>
                        v.type === "Teaser" || v.type === "Trailer"
                    ).key
                );
              if (trailer) {
                return (
                  <Player
                    playsinline
                    muted
                    width="100%"
                    controls
                    height="auto"
                    style={{
                      height: "auto",
                      flexShrink: 0,
                      flexGrow: 1,
                      aspectRatio: "16/9",
                    }}
                    playing
                    url={`https://www.youtube-nocookie.com/embed/${trailer}`}
                  />
                );
              } else {
                return (
                  <div className="flex items-center gap-4">
                    <p>Could not find a trailer for {movieName}</p>
                  </div>
                );
              }
            },
          },
          createGenerativeUi: {
            parameters: z.object({
              moviesFromContext: z
                .string()
                .describe(
                  "A comma separated list of movies from the chat context"
                ),
            }),
            description:
              "A tool used to generate UI in response to a user explicitly asking for UI",
            generate: async function* () {
              yield (
                <div className="flex items-center gap-4">
                  <IntegrationSpinner /> Getting movie posters...
                </div>
              );
              // parse the Langflow response to get the movie titles
              const titles = lastLangflowResponse.split("\n").map(title => title.trim());
              const client = new DataAPIClient(
                process.env.ASTRA_DB_APPLICATION_TOKEN!
              );
              const db = client.db(process.env.ASTRA_DB_API_ENDPOINT!);
              const movies: any = await db
                .collection("movies")
                .find(
                  { title: { $in: titles } },
                  {
                    limit: 4,
                  }
                )
                .toArray();
              return <Movies movies={movies} />;
            },
          },
        },
      });

      return {
        id: nanoid(),
        role: "assistant",
        display: result.value,
      };
    },
  },
  initialAIState: [],
  initialUIState: [],
});