export type Review = { author: string; rating: number; text: string };

export type Product = {
  id: string;
  name: string;
  price: number;
  image: string;
  description: string;
  reviews: Review[];
};

export const PRODUCTS: Product[] = [
  {
    id: "mug",
    name: "Ceramic Mug",
    price: 14,
    image: "/img/mug.svg",
    description: "A 350 ml stoneware mug. Dishwasher safe.",
    reviews: [
      { author: "Lin", rating: 5, text: "Keeps coffee warm for ages." },
      { author: "Sam", rating: 4, text: "Nice glaze, a bit heavy." },
    ],
  },
  {
    id: "notebook",
    name: "Dot Grid Notebook",
    price: 9,
    image: "/img/notebook.svg",
    description: "A5, 160 pages, lay-flat binding.",
    reviews: [{ author: "Ana", rating: 5, text: "Fountain pen friendly." }],
  },
  {
    id: "lamp",
    name: "Desk Lamp",
    price: 39,
    image: "/img/lamp.svg",
    description: "Dimmable LED desk lamp with USB-C power.",
    reviews: [],
  },
];

export function getProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}
