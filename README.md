
Cloudeebus
==========

Cloudeebus - DBus for the Cloud - is a component which enables calling DBus
 methods and registering on DBus signals from Javascript.


Install
-------

### Installing Cloudeebus from the project root directory:

Cloudeebus will install itself in Python's dist-packages folder. The
 cloudeebus.py wrapper shell goes in the executables path.

	sudo python setup.py install

See the [Getting Started](https://github.com/01org/cloudeebus/wiki/Getting-started)
 section of the [Cloudeebus wiki](https://github.com/01org/cloudeebus/wiki)
 for a list of dependencies to install.


### Running Cloudeebus:

The Cloudeebus server must be run either with credentials and a whitelist to
 restrict access to DBus services, or in opendoor mode.

	usage: cloudeebus.py [-h] [-v] [-d] [-o] [-p PORT] [-c CREDENTIALS] [-w WHITELIST]
	
	Javascript DBus bridge.
	
	optional arguments:
	  -h, --help            show this help message and exit
	  -d, --debug           log debug info on standard output
	  -v, --version         print version and exit
	  -o, --opendoor        allow anonymous access to all services
	  -p PORT, --port PORT  port number
	  -c CREDENTIALS, --credentials CREDENTIALS
	                        path to credentials file
	  -w WHITELIST, --whitelist WHITELIST
	                        path to whitelist file


Examples
--------

### dbus-tools

The /doc/dbus-tools folder contains dbus-send and dbus-register test pages.
Cloudeebus runs in opendoor mode, the dbus-tools pages have no manifest.

	cloudeebus.py --debug --opendoor &
	firefox ./doc/dbus-tools/dbus-register.html ./doc/dbus-tools/dbus-send.html &

### sample

The /doc/sample folder contains a working sample using credentials, whitelist and manifest.
Cloudeebus runs with credentials and a whitelist that are matched by the
 sample page manifest.

	cloudeebus.py --debug --credentials=./doc/sample/CREDENTIALS --whitelist=./doc/sample/WHITELIST &
	firefox ./doc/sample/cloudeebus.html &

The sample page is also online as a [live demo](http://01org.github.com/cloudeebus/).

Acknowledgements
----------------

Cloudeebus uses code from the following open-source projects:

  * [AutobahnJS](http://autobahn.ws/js) ([MIT](http://opensource.org/licenses/MIT) License)
  * [AutobahnPython](http://autobahn.ws/python) ([Apache 2.0](http://opensource.org/licenses/Apache-2.0) License)
