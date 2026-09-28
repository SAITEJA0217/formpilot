# Ground-truth schema

One JSON file per evaluated page. Each file is hand-written from the fixture's markup and
states what a careful human reader would say each field *means* — not what the engine
currently produces. Where the two disagree, the harness reports the gap; that is the
point of having ground truth at all.

```jsonc
{
  "page": "basic-html.html",          // file in frontend/public/test-forms/
  "variant": "",                      // optional suffix, for a page evaluated in >1 state
  "category": "Generic HTML",          // grouping for the compatibility matrix
  "platform": "generic-html",          // platform the engine is expected to report
  "url": "https://jobs.benchmark.local/apply",
  "notes": "",
  "mutations": [                       // applied in order before detection
    { "click": "#next" },              // drives the page's own script
    { "setHtml": { "selector": "#conditional", "html": "<input …>" } }
  ],
  "fields": [
    {
      "label": "Full Name",            // label the engine is expected to extract
      "type": "text",                  // expected unified FieldType
      "concept": "person.full_name",   // expected ontology concept, or null
      "expected": "Saiteja Reddy Kotha", // value that should be proposed, or null
      "outcome": "fill"                // fill | model | document | blocked | manual
    }
  ]
}
```

`outcome` is the expected disposition:

| Value | Meaning |
|---|---|
| `fill` | the engine should propose `expected` with no model call |
| `model` | the field legitimately needs a language model, so it is *not* scored for value accuracy offline |
| `document` | the engine should ask the user to pick a file, and propose nothing |
| `blocked` | the engine must refuse the field entirely |
| `manual` | the field is not confidently mappable; proposing a value counts as an error |
| `review` | genuinely ambiguous: the only requirement is that it is *not* filled confidently, so either `manual` or `model` is accepted |

`iframe-form.html` is deliberately **not** in this dataset: jsdom does not load iframe
`src` documents, so an offline run would measure nothing. Frame traversal is covered by
`tests/integration/shadow-iframe.test.ts` with synthetic frames, and the page itself is
listed for manual browser verification.
