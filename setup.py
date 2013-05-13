#!/usr/bin/env python

# Cloudeebus
#
# Copyright (C) 2012 Intel Corporation. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Luc Yriarte <luc.yriarte@intel.com>
# Christophe Guiraud <christophe.guiraud@intel.com>
# Frederic Paut <frederic.paut@intel.com>
#

from setuptools import setup

setup(name = "cloudeebus",
	version = "0.3.2",
	description = "Javascript-DBus bridge",
	author = "Luc Yriarte, Christophe Guiraud, Frederic Paut",
	author_email = "luc.yriarte@intel.com, christophe.guiraud@intel.com, frederic.paut@intel.com",
	url = "https://github.com/01org/cloudeebus/wiki",
	license = "http://www.apache.org/licenses/LICENSE-2.0",
	scripts = ["cloudeebus/cloudeebus.py"],
	packages = ["cloudeebus"],
	data_files = [("cloudeebus" ,["AUTHORS", "README.md", "LICENSE"])],
	platforms = ("Any"),
	install_requires = ["setuptools", "autobahn>=0.5.8"],
	classifiers = ["License :: OSI Approved :: Apache Software License",
		  "Development Status :: 3 - Alpha",
		  "Environment :: Console",
		  "Intended Audience :: Developers",
		  "Operating System :: OS Independent",
		  "Programming Language :: Python",
		  "Topic :: Internet",
		  "Topic :: Software Development :: Libraries"],
	keywords = "cloudeebus autobahn websocket dbus javascript bridge")
