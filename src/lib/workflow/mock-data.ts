import type { CostingStatus } from "./status";

export type CostingRequestSummary = {
  id: string;
  requestNumber: string;
  styleNumber: string;
  productName: string;
  factoryName: string;
  status: CostingStatus;
  ageDays: number;
  totalCost: string;
  variance: string;
  owner: string;
};

export const costingRequests: CostingRequestSummary[] = [
  {
    id: "CR-1007",
    requestNumber: "CR-1007",
    styleNumber: "M8819347",
    productName: "Performance woven jacket",
    factoryName: "Factory A",
    status: "for_pbd_review",
    ageDays: 2,
    totalCost: "USD 11.84",
    variance: "+4.2%",
    owner: "PBD"
  },
  {
    id: "CR-1006",
    requestNumber: "CR-1006",
    styleNumber: "M8819210",
    productName: "Fleece hoodie",
    factoryName: "Factory B",
    status: "needs_clarification",
    ageDays: 5,
    totalCost: "USD 8.35",
    variance: "+18.7%",
    owner: "Factory"
  },
  {
    id: "CR-1005",
    requestNumber: "CR-1005",
    styleNumber: "M8819054",
    productName: "Knit short sleeve tee",
    factoryName: "Factory C",
    status: "approved",
    ageDays: 1,
    totalCost: "USD 4.10",
    variance: "-1.8%",
    owner: "Done"
  }
];

export const requestDetail = {
  ...costingRequests[0],
  bomLines: [
    {
      category: "Fabric",
      material: "Nylon stretch woven",
      consumption: "1.42 yd",
      unitCost: "USD 3.10",
      total: "USD 4.40",
      issue: "Within benchmark"
    },
    {
      category: "Trim",
      material: "Waterproof zipper",
      consumption: "1 pc",
      unitCost: "USD 1.25",
      total: "USD 1.25",
      issue: "Within benchmark"
    },
    {
      category: "Packaging",
      material: "Hangtag and polybag",
      consumption: "1 set",
      unitCost: "USD 0.38",
      total: "USD 0.38",
      issue: "Missing supplier reference"
    }
  ],
  validation: [
    {
      severity: "warning",
      message: "Packaging line is missing supplier reference.",
      field: "Packaging supplier"
    },
    {
      severity: "info",
      message: "Total cost is 4.2% above similar historical styles.",
      field: "CBD total"
    }
  ],
  activity: [
    "Created from NextGen style M8819347",
    "BOM pulled from NextGen",
    "Factory submitted CBD",
    "System validation completed"
  ]
};
