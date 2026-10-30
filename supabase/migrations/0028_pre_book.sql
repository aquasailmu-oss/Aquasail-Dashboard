-- Pre-book is a payment method only. Selecting it does not create a payment
-- or change the booking/payment status; the future calculation is deliberately
-- left as an extension point until the business formula is supplied.
alter type public.payment_method add value if not exists 'pre_book';
