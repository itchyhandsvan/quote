// Business details and standard wording printed on every PDF.
// Everything here can be edited in the app's Settings panel; edits are saved on that device.

const STORAGE_KEY = "itchyquote.settings.v1";

export const SETTING_FIELDS = [
  { key: "businessName", label: "Business name" },
  { key: "tagline", label: "Tagline" },
  { key: "website", label: "Website" },
  { key: "address", label: "Address", multiline: true },
  { key: "phone", label: "Phone" },
  { key: "uen", label: "UEN (invoice)" },
  { key: "mission", label: "Mission statement", multiline: true },
  { key: "scopeLabel", label: "Quotation: scope of work label", multiline: true },
  { key: "scopeText", label: "Quotation: scope of work description", multiline: true },
  { key: "mouldText", label: "Quotation: mould & testing description", multiline: true },
  { key: "deliveryText", label: "Quotation: delivery description", multiline: true },
  { key: "validity", label: "Quotation: validity line" },
  { key: "terms", label: "Quotation: terms & conditions (blank line between paragraphs)", multiline: true, tall: true },
  { key: "quotePaymentTerms", label: "Quotation: payment terms", multiline: true },
  { key: "invoicePaymentTerms", label: "Invoice: payment terms", multiline: true },
];

export const DEFAULT_SETTINGS = {
  businessName: "ITCHYHANDSVAN",
  tagline: "Customised Fake Food Displays",
  website: "www.itchyhandsvan.com",
  address: "596C Ang Mo Kio Street 52\n25-341, Singapore 563596",
  phone: "+65 8922 2124",
  uen: "UEN 53466890M",
  mission:
    "It is our mission to recreate each dish to encapsulate all its glories, along with the " +
    "memories and sensorial emotions that it evokes. We take the same care in crafting every " +
    "creation as it takes to prep and cook the dish, ensuring that the replica you receive is " +
    "one-of-a-kind in quality and craftsmanship.",
  scopeLabel: "Materials,\nDevelopment,\nProduction",
  scopeText:
    "Estimated labour and materials for construction: ordering and assembly, construction, " +
    "testing & adjustments, composition.",
  mouldText: "Custom mould creation, sculpting, testing & adjustments",
  deliveryText: "Estimated shipping. Actual amount billed at cost.",
  validity: "Quotation is valid for 30 Days.",
  terms: [
    "Upon execution of this Agreement, a non-refundable upfront payment of 35% of the fees, as " +
      "stated in the attached quotation, is required. Production of the food prototype shall start " +
      "once payment is received. The remaining 65% of the fees shall be paid upon delivery of the " +
      "final product(s).",
    "There will be one round of review, and any amendments to the food prototype shall be " +
      "addressed at this stage. Photos of the food prototype will be sent to the Customer. Approval " +
      "is required from the Customer with regard to the (i) plate/tableware, (ii) ingredients, and " +
      "(iii) composition of the food prototype. Upon the Customer’s approval, production on the " +
      "final product(s) shall begin. No further amendments will be entertained once the glazing " +
      "and/or curing of resin of the final product(s) has begun.",
    "All products developed by ITCHYHANDSVAN are intended for display purposes only, and are " +
      "provided to the Customer “as-is”. ITCHYHANDSVAN is not liable for any damages, direct, " +
      "indirect, punitive, incidental, special, or consequential, or loss resulting from the use of " +
      "ITCHYHANDSVAN product(s) in any way that is contrary to its intended purpose.",
    "The Customer shall have full ownership rights to the final product(s) developed by " +
      "ITCHYHANDSVAN, unless otherwise specified. ITCHYHANDSVAN shall, subject to this Agreement " +
      "on a royalty free basis, have free use of such products.",
    "All moulds created in the course of production are the property of ITCHYHANDSVAN, unless " +
      "otherwise specified.",
    "Any writings (including but not limited to prototypes, photographs, diagrams, and models) " +
      "developed during the course of production, which are not part of the final product(s), " +
      "shall be the exclusive property of ITCHYHANDSVAN.",
    "Notwithstanding the above, both parties agree that any intellectual property right in " +
      "existence prior to this Agreement (either as a filed application or already obtained), " +
      "shall remain the sole property of the originating party.",
    "The Customer may terminate this Agreement at any time with written notice to ITCHYHANDSVAN " +
      "provided always that the fees paid shall be forfeited. ITCHYHANDSVAN may terminate this " +
      "Agreement if unreasonable additions, alterations and/or variations to the food prototypes " +
      "and/or final product(s) are required by the Customer.",
  ].join("\n\n"),
  quotePaymentTerms:
    "35% upon the execution of this Agreement, 65% upon delivery of the final product(s).\n" +
    "Payment details will be provided upon confirmation of job.",
  invoicePaymentTerms: "35% upon quotation agreement, 65% upon delivery of product(s).",
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function resetSettings() {
  localStorage.removeItem(STORAGE_KEY);
  return { ...DEFAULT_SETTINGS };
}
