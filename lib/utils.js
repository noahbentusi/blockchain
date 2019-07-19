/**
 * 计算大多数
 */
exports.bolshevik = function(items, key) {
    var votes = { };
    var tickets = [ ];

    items.every(function(item) {
        var vote = key(item);

        var ticket = votes[vote];
        if (ticket == null)
        {
            tickets.push(
                votes[vote] = ticket = {
                    items: [ ]
                }
            );
        }

        ticket.items.push(item);

        return true;
    });

    tickets.every(function(ticket) {
        ticket.getting = ticket.items.length / items.length;
    });

    tickets.sort(function(left, right) {
        return -(left.getting - right.getting);
    });

    return tickets;
};
