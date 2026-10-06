---
name: Large-response proxy failures
description: Diagnose app-side 200 versus empty Google Frontend 500 on large JSON responses.
---

Application success logs do not prove that the deployment frontend delivered a response. A large buffered HTTP/1 response can be rejected after the API reports 200.

**Why:** The attendance detail endpoint returned more than 32 MiB of JSON. Application logs at the incident timestamp reported 200, while the browser received an empty HTML 500 from Google Frontend. Earlier warehouse query optimization could not fix this response-delivery failure.

**How to apply:** If the browser's error has an empty or HTML body but the matching API log says 200, measure the full serialized response, including additional link maps. Google's HTTP/1 frontend limit is 32 MiB for responses that are not chunked or streamed. Preserve the data contract and use negotiated compression plus streaming, rather than silently dropping rows. Verify transport with a payload exceeding the limit and check both gzip and identity clients; successful SQL and typechecks alone are insufficient.

Reference: https://cloud.google.com/run/quotas
