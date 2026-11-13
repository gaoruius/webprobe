# BuggyShop product spec

How the shop is supposed to work, as a product manager would write it. WebProbe can read this
with `WEBPROBE_SPEC=../buggyshop/SPEC.md`. It describes intended behavior, not known bugs.

## Product list (/)

- Every product shows its image, name and price, and has an "Add to cart" button.
- Images have a text alternative with the product name.

**Search**
- Given the product list, when I type part of a product's name in "Search products", then only
  products whose name contains that text are shown, whatever the capitalization.
- When nothing matches, a "No products match" message is shown.

**Sort**
- "Price: low to high" lists the cheapest product first; "Price: high to low" the most expensive
  first. "Featured" restores the default order.

## Product page (/product/<id>)

- Shows the name, price, an "Add to cart" button and two tabs: Description and Reviews.
- When I open the Reviews tab, I see every review (author, stars, text), or "No reviews yet."

## Cart (/cart)

- Lists each item with its price and an editable quantity. The total updates as soon as a
  quantity changes.
- Setting a quantity to 0 removes the item from the cart.
- **Bulk discount:** given 10 or more of the same product in the cart, that product's line gets
  10% off, and the cart says so.
- **Coupons:** valid codes are SAVE10 (10% off) and WELCOME20 (20% off). Applying a valid code
  shows a confirmation and lowers the total. Applying an invalid code, or a code that can't be
  applied for any reason, shows an error message and leaves the total unchanged.
- The header shows the number of items in the cart.

## Checkout (/checkout)

- Shows each line, the subtotal, any coupon discount, shipping and the order total.
- Shipping is $5, and free when the items come to more than $50.
- The shipping form asks for full name, street address and a 5-digit ZIP code. Every field has
  a visible label. Missing or invalid fields show an error and nothing is ordered.
- **Placing an order:** given a valid form, when I click "Place order", then I see a
  confirmation with the order number and a "View order" link, and **the cart is empty**
  (the header shows Cart (0)).
- "View order" opens that order's page, showing its lines, shipping and total.

## Sign up (/signup)

- Email must be a valid address and the password at least 8 characters. Invalid input shows an
  error and no account is created.
- On success, a welcome message with the email is shown.
