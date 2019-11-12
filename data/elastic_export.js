const path = require('path');
const es = require('elasticsearch');
const client = new es.Client({
    host: 'localhost:9200',
});
const util = require(path.join(__dirname, 'util.js'));
const log = util.log('es_export');

async function delete_index(name) {
    try {
        log('Deleting ' + name + ' index...', 'info');
        return await client.indices.delete({ index: name });
    }
    catch (error) {
        log(error, 'error');
    }
}

async function bulk_add(operations, index_name, index_type) {
    let body = [];

    for (let i = 0; i < operations.length; i++) {
        let index_statement = {
            index: {
                _index: index_name,
                _type: index_type,
                _id: i,
            }
        };
        body.push(index_statement);
        body.push(operations[i]);
    }

    try {
        log('Bulk loading...', 'info');
        const result = await client.bulk({
            body: body
        });

        result.items.forEach(i => {
            if (i.index.error) {
                // TODO ensure this error is thrown & caught properly and that the error message is useful
                throw new Error(JSON.stringify(i));
            }
        });

        return result;
    }
    catch (error) {
        log(error, 'error');
    }
}

async function bulk_update(operations, index_name, index_type) {
    let body = [];
    operations.forEach(op => {
        let update_statement = {
            update: {
                _index: index_name,
                _type: index_type,
                _id: parseInt(op.id),
            }
        };
        body.push(update_statement);
        body.push(op.body);
    });

    try {
        log('Bulk updating...', 'info');
        const result = await client.bulk({
            timeout:"6s",
            body: body
        });

        result.items.forEach(i => {
            if (i.update.error) {
                throw new Error(JSON.stringify(i));
            }
        });

        return result;
    }
    catch (error) {
        log(error, 'error');
    }
}

async function create_index(name) {
    log('Creating ' + name + ' index...', 'info');
    let created = await client.indices.exists({ index: name });
    if (!created) {
        return await client.indices.create({ index: name });
    }
    else {
        log(error, 'error');
    }
}

async function indexing_stats(name) {
    let stats = await client.indices.stats({ index: name });
    let count = stats.indices[name].total.indexing.index_total;
    return count;
}

async function reload_index(operations, transform, index_name, index_type) {
    try {
        await delete_index(index_name);
        await create_index(index_name);
        await bulk_add(operations, transform, index_name, index_type, 0);
    } catch (error) {
        log(error, 'error');
    }
}


async function add_synonym_mappings(name){
    try{
        let map_body = {
            properties: {
                all_fields: {
                    type: "text",
                    analyzer: "synonym"
                },
                countries: {
                    type: "text",
                    analyzer: "synonym"
                },
                nationality_country: {
                    type: "text",
                    analyzer: "synonym"
                },
                citizenship_country: {
                    type: "text",
                    analyzer: "synonym"
                },
                nationality_of_registration: {
                    type: "text",
                    analyzer: "synonym"
                }
            }
        }
        await client.indices.putMapping({index:name, type:"_doc", body:map_body});
    }
    catch(error){
        log(error, 'error');
    }
}

module.exports = {
    reload_index: reload_index,
    bulk_add: bulk_add,
    bulk_update: bulk_update,
    delete_index: delete_index,
    create_index: create_index,
    indexing_stats: indexing_stats
}
