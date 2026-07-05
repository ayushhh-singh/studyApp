import { createClient } from "@supabase/supabase-js";
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
await client.from("questions").update({ marks: 2 }).in("id", ["2aa11433-10f5-4752-ae84-d418e36cd194","433aafce-2b9e-4bfb-9b8c-931cfbae0e89"]);
console.log("patched");
