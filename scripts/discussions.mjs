import Stream from "stream";
import { promisify } from "util";

import { graphql } from "@octokit/graphql";
import gunzip from "gunzip-maybe";
import tar from "tar-stream";
import fetch from "node-fetch";
import undoc from "@mcansh/undoc";
import parseAttributes from "gray-matter";

const { findMatchingEntries, getPackage } = undoc;

const pipeline = promisify(Stream.pipeline);

if (!process.env.GITHUB_TOKEN) {
  throw new Error("GITHUB_TOKEN not set");
}

if (!process.env.GITHUB_REPOSITORY) {
  throw new Error("GITHUB_REPOSITORY not set");
}

if (!process.env.GITHUB_REPOSITORY_ID) {
  throw new Error("GITHUB_REPOSITORY_ID not set");
}

if (!process.env.GITHUB_CATEGORY_ID) {
  throw new Error("GITHUB_CATEGORY_ID not set");
}

let [OWNER, REPO] = process.env.GITHUB_REPOSITORY.split("/");

let gql = String.raw;

let octokit = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_TOKEN}`,
  },
});

async function getDocs() {
  let stream = await getPackage(
    // process.env.GITHUB_REPOSITORY,
    "remix-run/remix",
    "refs/heads/main"
  );

  if (!stream) {
    throw new Error(
      "🚨 There was a problem fetching the file from GitHub. The request " +
        `responded with a ${response.status} status. Please try again later.`
    );
  }

  let existingDiscussions = await getExistingDiscussions();
  console.dir(existingDiscussions, { depth: null });

  await findMatchingEntries(stream, "/docs", async (entry) => {
    if (!entry.path.endsWith(".md")) {
      console.log(`Skipping ${entry.path}`);
      return;
    }

    let { title, url } = await parseDoc(entry);

    let exists = existingDiscussions.find(
      (discussion) => discussion.node.title === title
    );
    if (exists) {
      console.log(
        `A discussion for ${title} already exists; ${exists.node.url}`
      );
      return;
    }

    await createDiscussion(title, url);
  });
}

async function fetchDiscussions(results = [], cursor) {
  let result = await octokit(
    gql`
      query LIST_DISCUSSIONS(
        $name: String!
        $owner: String!
        $categoryId: ID!
        $cursor: String
      ) {
        repository(name: $name, owner: $owner) {
          discussions(categoryId: $categoryId, first: 20, after: $cursor) {
            pageInfo {
              endCursor
              hasNextPage
            }
            edges {
              node {
                title
                url
              }
            }
          }
        }
      }
    `,
    {
      name: REPO,
      owner: OWNER,
      categoryId: process.env.GITHUB_CATEGORY_ID,
      cursor,
    }
  );

  results.push(...result.repository.discussions.edges);

  if (result.repository.discussions.pageInfo.hasNextPage) {
    await fetchDiscussions(
      results,
      result.repository.discussions.pageInfo.endCursor
    );
  }

  return results;
}

async function getExistingDiscussions() {
  try {
    return fetchDiscussions();
  } catch (error) {
    throw new Error(
      "🚨 There was a problem fetching the discussions. Please try again later."
    );
  }
}

async function parseDoc(entry) {
  let { data } = parseAttributes(entry.content);
  let title = data.title || entry.path.replace(/^\/docs/, "");
  let url = new URL(entry.path, "https://remix.run");
  return { title, url: url.toString() };
}

async function createDiscussion(title, url) {
  let result = await octokit(
    gql`
      mutation CREATE_DISCUSSION(
        $repositoryId: ID!
        $title: String!
        $body: String!
        $categoryId: ID!
      ) {
        createDiscussion(
          input: {
            repositoryId: $repositoryId
            title: $title
            body: $body
            categoryId: $categoryId
          }
        ) {
          discussion {
            url
            title
          }
        }
      }
    `,
    {
      repositoryId: process.env.GITHUB_REPOSITORY_ID,
      categoryId: process.env.GITHUB_CATEGORY_ID,
      title,
      body: url,
    }
  );

  console.log(result.createDiscussion.discussion);
}
getDocs();
