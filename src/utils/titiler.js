import { DynamicClient } from "dynamic-client";

export default async function TiTiler({ url }) {
  const client = new DynamicClient({ url });
  await client.init();
  return client;
}
