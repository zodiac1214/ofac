'use strict';

const fs = require('fs');
const path = require('path');
const exporter = require(path.join(__dirname, 'elastic_export.js'));
const util = require(path.join(__dirname, 'util.js'));
const log = util.log('sdn_export');

Set.prototype.union = function(setB) {
    var union = new Set(this);
    for (var elem of setB) {
        union.add(elem);
    }
    return union;
}

const transform = entry => {
    // Augment the entry with these fields
    entry.identity_id          = entry.identity.id;
    entry.primary_display_name = entry.identity.primary.display_name;
    entry.programs             = [];
    entry.sanction_dates       = [];
    entry.countries            = [];
    entry.all_display_names    = [];
    entry.doc_id_numbers       = [];
    entry.linked_profile_ids   = [];
    entry.linked_profile_names = [];
    entry.aircraft_tags        = [];
    entry.vessel_tags          = [];
    entry.all_fields           = [];
    entry.sdn_display          = '';
    entry.document_countries   = [];

    const programs  = new Set();
    const countries = new Set();
    const lists     = new Set();
    const document_countries = new Set();

    entry.sanctions_entries.forEach(e => {
        lists.add(list_to_acronym(e.list));
        e.program.forEach(program => {
            if (program) {
                programs.add(program);
                const program_country = program_to_country(program);
                if (program_country != null) {
                    countries.add(program_country);
                }
            }
        });
        e.entry_events.forEach(event => {
            entry.sanction_dates.push(String(event[0]));
        });
    });
    entry.programs = Array.from(programs).sort();

    if (lists.delete('Non-SDN')) {
        if (lists.delete('SDN')) {
            entry.sdn_display += '[SDN] ';
            entry.is_sdn = lists.has('SDN');    // denote that this is an SDN entry for future purposes (might be useful)
        }
        entry.sdn_display += '[Non-SDN';
        if (lists.size) {
            entry.sdn_display += ': ' + Array.from(lists).sort().join(', ');
        }
        entry.sdn_display += ']';
    }

    entry.linked_profiles.forEach(p => {
        entry.linked_profile_ids.push(p.linked_id);
        entry.linked_profile_names.push(p.linked_name.display_name);
    });

    entry.all_display_names.push(entry.primary_display_name);
    entry.identity.aliases.forEach(alias => {
        entry.all_display_names.push(alias.display_name);
        if (alias.date_period !== null) {
            log('OFAC has started associating date periods with aliases.  These will not be rendered.', 'error');
        }
        delete alias.date_period;

        // simply for decreasing complexity within the rendering template. TODO should probably be moved to XML parser?
        if (alias.is_low_quality) {
            alias.strength = 'weak';
        }
        else {
            alias.strength = 'strong';
        }
    });

    Object.keys(entry.features).forEach(f_key => {
        const formatted_key = f_key.split(' ').map(w => w.toLowerCase()).join('_');    // e.g. 'Citizenship Country' -> 'citizenship_country'
        const combined_info = [];

        entry.features[f_key].forEach(f => {
            if (f.details) {
                combined_info.push(f.details);
                if (f_key == 'SWIFT/BIC') {
                    entry.doc_id_numbers.push(f.details);
                    entry.doc_id_numbers.push(f_key);
                }
            }

            if (f.date) {
                combined_info.push(f.date);
            }

            if (f.location) {
                combined_info.push(f.location['COMBINED']);

                if (f.location["COUNTRY"]) {
                    countries.add(f.location["COUNTRY"]);
                }
            }
        });

        entry[formatted_key] = combined_info;
    });

    entry.documents.forEach(doc => {
        // for searchability
        entry.doc_id_numbers.push(doc.id_number);
        entry.doc_id_numbers.push(doc.type);
        if (doc.type.indexOf('Vessel') > -1) {
            entry.vessel_tags.push(doc.id_number);
        }

         // for website display
        if (doc.validity != 'Valid' && doc.validity != 'Fraudulent') {
            log('An invalid document status appeared (normally Valid or Fraudulent): ' + doc.validity, 'warning');
        }

        const headers = []

        // TODO the nullification on 'None' logic should be moved to the XML parser.
        if (doc.issued_by != 'None') {
            headers.push('issued_by');
            countries.add(doc.issued_by);
            document_countries.add(doc.issued_by);
        }
        else {
            doc.issued_by = null;
        }

        if (doc.issued_in != 'None') {
            doc.issued_in = JSON.parse(doc.issued_in);      // this is actually a location dictionary
            headers.push('issued_in');
            countries.add(doc.issued_in['COUNTRY']);
            document_countries.add(doc.issued_in['COUNTRY']);
            doc.issued_in = doc.issued_in['COMBINED'];      // no longer a location dictionary
        }
        else {
            doc.issued_in = null;
        }

        if (doc.issuing_authority != 'None') {
            headers.push('issuing_authority');
            countries.add(doc.issuing_authority);
            document_countries.add(doc.issuing_authority);
        }
        else {
            doc.issuing_authority = null;
        }

        Object.keys(doc.relevant_dates).forEach(date => {
            doc[date] = doc.relevant_dates[date];
            headers.push(date);
        });

        entry.document_headers = headers;
    });

    entry.countries = Array.from(countries);

    // Create tags field for aircraft
    let aircraft_fields = [ 'aircraft_construction_number_(also_called_l/n_or_s/n_or_f/n',
                            'aircraft_manufacturer\'s_serial_number_(msn)',
                            // 'aircraft_manufacture_date',
                            'aircraft_model',
                            'aircraft_operator',
                            'aircraft_tail_number',
                            'previous_aircraft_tail_number'];

    aircraft_fields.forEach(field=>{
        if (entry[field]) {
            entry.aircraft_tags.push(String(entry[field]));
        }
    });

    // Create tags field for vessels
    let vessel_fields = [
        'vessel_call_sign',
        'other_vessel_call_sign',
        'vessel_flag',
        'other_vessel_flag',
        'vessel_owner',
        'vessel_tonnage',
        'vessel_gross_registered_tonnage',
        'vessel_type']

    vessel_fields.forEach(field => {
        if (entry[field]) {
            entry.vessel_tags.push(String(entry[field]));
        }
    });

    if(entry.countries != null){
        entry.countries = add_country_synonyms(entry.countries);
    }
    if(entry.nationality_country != null){
        entry.nationality_country = add_country_synonyms(entry.nationality_country);
    }
    if(entry.citizenship_country != null){
        entry.citizenship_country = add_country_synonyms(entry.citizenship_country);
    }
     if(entry.nationality_of_registration != null){
        entry.nationality_of_registration = add_country_synonyms(entry.nationality_of_registration);
    }

    // Fields not included: linked_profile_ids (not relevant), fixed_ref
    const all_fields = [
        'primary_display_name',
        'identity_id',
        'all_display_names',
        'programs',
        'doc_id_numbers',
        'linked_profile_names',
        'location',
        'title',
        'birthdate',
        'place_of_birth',
        'additional_sanctions_information_-_',
        'vessel_call_sign',
        'other_vessel_call_sign',
        'vessel_flag',
        'other_vessel_flag',
        'vessel_owner',
        'vessel_tonnage',
        'vessel_gross_registered_tonnage',
        'vessel_type',
        'nationality_country',
        'citizenship_country',
        'gender',
        'website',
        'email_address',
        'swift/bic',
        'ifca_determination_-_',
        'aircraft_construction_number_(also_called_l/n_or_s/n_or_f/n)',
        'aircraft_manufacturer’s_serial_number_(msn)',
        'aircraft_manufacture_date',
        'aircraft_model',
        'aircraft_operator',
        'bik_(ru)',
        'un/locode',
        'aircraft_tail_number',
        'previous_aircraft_tail_number',
        'micex_code',
        'nationality_of_registration',
        'd-u-n-s_number',
        'party_sub_type',
        'countries',
    ];

    all_fields.forEach(field =>{
        if (entry[field]) {
            entry.all_fields.push(String(entry[field]))
        }
    });

    entry.document_countries = Array.from(document_countries);

    entry.all_fields.push(entry.sdn_display);

    return entry;
}

async function transform_sdn() {
    const transformed = [];

    const sdn    = JSON.parse(fs.readFileSync(path.join(__dirname, '/update_files/sdn.json'),     'utf8'));
    const nonsdn = JSON.parse(fs.readFileSync(path.join(__dirname, '/update_files/non_sdn.json'), 'utf8'));
    nonsdn.forEach(e => sdn.push(e));

    const seen_values = new Set();
    let j = 0;
    for (let i = 0; i < sdn.length; i++) {
        const this_id = sdn[i].fixed_ref;
        if (!seen_values.has(this_id)) {
            transformed[j] = transform(sdn[i]);
            j++;
            seen_values.add(this_id);
        }
    }

    fs.writeFileSync(path.join(__dirname, '/update_files/transformed_combined.json'), JSON.stringify(transformed), 'utf8');
    return transformed;
}

let add_country_synonyms = country_list=>{
    let country_set = new Set(country_list);
    for(let country of country_set){
        var synonyms = country_synonyms(country);
        if(synonyms != null){
            country_set = country_set.union(synonyms);
        }
    }
    var new_set = Array.from(country_set);
    if(new_set != country_list){
	//console.log("Changed list");
    }
    return Array.from(country_set);
}

let country_synonyms = country =>{
    let korea_set = new Set(["NK", "DPRK", "Democratic People's Republic of Korea", "Korea, North",  "North Korea"]);
    let drc_set = new Set(["DRC", "Democratic Republic of the Congo", "Congo, Democratic Republic of the"]);
    let us_set = new Set(["US", "USA", "America", "United States"]);
    let russia_set = new Set(["Russian Federation", "Russia"]);
    let england_set = new Set(["England", "UK", "United Kingdom", "Britain"]);
    let uae_set = new Set(["UAE", "United Arab Emirates"]);
    let car_set = new Set(["CAR", "Central African Republic"]);

    let all_sets = [korea_set, drc_set, us_set, russia_set, england_set, uae_set, car_set];
    const dict = {}
    all_sets.forEach(set=>{
        for(let key of set){
            dict[key] = set;
        }
    });
    return dict[country];
}

let program_to_country = program => {
    const dict = {
        'BALKANS': 'Balkans',
        'BELARUS': 'Belarus',
        'BURUNDI': 'Burundi',
        'CAR': 'Central African Republic',
        'CUBA': 'Cuba',
        'DARFUR': 'Darfur',
        'DPRK': 'North Korea',
        'DPRK2': 'North Korea',
        'DPRK3': 'North Korea',
        'DPRK4': 'North Korea',
        'DRCONGO': 'Congo',
        'FSE-SY': 'Syria',
        'HRIT-IR': 'Iran',
        'HRIT-SY': 'Syria',
        'IFSR': 'Iran',
        'IRAN': 'Iran',
        'IRAN-TRA': 'Iran',
        'IRAQ': 'Iraq',
        'IRAQ2': 'Iraq',
        'IRGC': 'Iran',
        'ISA': 'Iran',
        'LEBANON': 'Lebanon',
        'LIBYA2': 'Lybia',
        'LIBYA3': 'Lybia',
        'MAGNIT': 'Russia',
        'NS-PLC': 'Palestine',
        'SOMALIA': 'Somalia',
        'SOUTH SUDAN': 'South Sudan',
        'SYRIA': 'Syria',
        'UKRAINE-EO13660': 'Ukraine',
        'UKRAINE-EO13661': 'Ukraine',
        'UKRAINE-EO13662': 'Ukraine',
        'UKRAINE-EO13685': 'Ukraine',
        'VENEZUELA': 'Venezuela',
        'YEMEN': 'Yemen',
        'ZIMBABWE': 'Zimbabwe',
    };

    return dict[program];
}

let list_to_acronym = l => {
    if (l.endsWith(' List')) {
        l = l.slice(0, -1 * ' List'.length);
    }

    const dict = {
        'Sectoral Sanctions Identifications': 'SSI',
        'Non-SDN Palestinian Legislative Council': 'NSPLC',
        'Executive Order 13599': 'EO13599',
        'Part 561': '561List',
        'Consolidated': 'Non-SDN'
    }

    return dict[l] || l;
}

async function load_sdn(entries) {
    await exporter.delete_index('sdn');
    await exporter.create_index('sdn');

    await exporter.bulk_add(entries, 'sdn', 'entry', 'fixed_ref');
    let count = await exporter.indexing_stats('sdn');
    log(count + ' documents indexing', 'info');
}

async function main() {
    const entries = await transform_sdn();
    await load_sdn(entries);
}

main();
